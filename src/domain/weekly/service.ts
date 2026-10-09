import "server-only";
import { testStatusMatcher } from "@/domain/issues/stage";
import { getAllStatuses, searchAll } from "@/lib/jira/api";
import { JiraError } from "@/lib/jira/errors";
import { issueHistories } from "@/lib/jira/operations";
import type { SearchIssue } from "@/lib/jira/schemas";
import { teamsTargetLabel } from "@/domain/settings/schema";
import { weeklyReportCard } from "@/lib/teams/cards";
import { deliverTeamsCard, resolveTeamsTarget, type TeamsSelection } from "@/lib/teams/send";
import type { Context } from "@/lib/server/context";
import { buildWeekReport, type ActivityData, type ActivityIssue, type BugIssue, type WeekReport, type WeekTotals } from "./activity";
import type { SavedWeek } from "./store";
import { jqlDate, recentWeeks, shiftWeek, weekIdOf, weekLabel, weekNumber, weekRange } from "./week";

/** Geçmiş tablosunda ve panodaki grafikte gösterilen hafta sayısı. */
const HISTORY_WEEKS = 12;
const MAX_ISSUES = 3000;
const DAY = 86_400_000;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function toActivityIssue(issue: SearchIssue, effortField: string | undefined): ActivityIssue {
  const f = issue.fields as Obj;
  const type = obj(f.issuetype);
  const status = obj(f.status);
  const versions = Array.isArray(f.fixVersions) ? f.fixVersions.map((v) => str(obj(v)?.name)).filter((n): n is string => Boolean(n)) : [];
  const effort = effortField ? f[effortField] : undefined;
  return {
    id: issue.id,
    key: issue.key,
    summary: str(f.summary) ?? "",
    type: type ? { name: str(type.name) ?? "", iconUrl: str(type.iconUrl) } : undefined,
    status: { name: str(status?.name) ?? "?", category: str(obj(status?.statusCategory)?.key) ?? "undefined" },
    release: versions.length ? versions.join(", ") : undefined,
    effort: typeof effort === "number" && Number.isFinite(effort) ? effort : undefined,
  };
}

/** [from, to) aralığındaki aktiviteyi Jira'dan okur (salt okuma). */
export async function loadActivity(ctx: Context, from: Date, to: Date): Promise<ActivityData> {
  const me = await ctx.myself();
  const settings = await ctx.settings.read();
  const effortField = settings.fields.storyPointTest?.id;
  const fields = ["summary", "issuetype", "status", "fixVersions", ...(effortField ? [effortField] : [])];
  // JQL tarihleri Jira profil saat dilimiyle yorumlanır; sunucunun saat dilimi farklıysa hafta kenarındaki
  // olaylar kaçmasın diye pencere bir gün genişletilir. Kesin süzme aşağıda zaman damgasıyla yapılır.
  const qFrom = jqlDate(new Date(from.getTime() - DAY));
  const qTo = jqlDate(new Date(to.getTime() + DAY));
  const during = `DURING ("${qFrom}", "${qTo}")`;

  const [moved, assigned, bugs, statuses] = await Promise.all([
    searchAll(ctx.jira, `status changed BY currentUser() ${during}`, { fields, maxIssues: MAX_ISSUES }),
    searchAll(ctx.jira, `assignee changed TO currentUser() ${during}`, { fields, maxIssues: MAX_ISSUES }),
    searchAll(ctx.jira, `reporter = currentUser() AND issuetype = Bug AND created >= "${qFrom}" AND created < "${qTo}"`, {
      fields: [...fields, "created"],
      maxIssues: MAX_ISSUES,
    }).catch((error: unknown) => {
      // Kapsamda "Bug" tipi yoksa JQL geçersizdir; rapor bug listesi olmadan devam eder.
      if (error instanceof JiraError && error.status === 400) {
        console.warn("[weekly] Bug araması geçersiz; rapor bug listesi olmadan hazırlanıyor.", error.message);
        return [] as SearchIssue[];
      }
      throw error;
    }),
    getAllStatuses(ctx.jira),
  ]);

  const issues = new Map<string, ActivityIssue>();
  for (const i of [...moved, ...assigned]) issues.set(i.id, toActivityIssue(i, effortField));
  const history = await issueHistories(ctx.jira, [...issues.keys()], ["status", "assignee"]);
  const start = from.getTime();
  const end = to.getTime();
  const inRange = (t: number) => t >= start && t < end;

  return {
    issues,
    statusEvents: history
      .filter((h) => h.field === "status" && inRange(h.at))
      .map((h) => ({ issueId: h.issueId, at: h.at, from: h.from, to: h.to, byMe: h.authorId === me.accountId })),
    assignEvents: history.filter((h) => h.field === "assignee" && h.to === me.accountId && inRange(h.at)).map((h) => ({ issueId: h.issueId, at: h.at })),
    bugs: bugs.map((b): BugIssue => ({ ...toActivityIssue(b, effortField), created: str((b.fields as Obj).created) ?? "" })),
    statuses: new Map(statuses.map((s) => [s.id, { name: s.name, category: s.statusCategory?.key ?? "undefined" }])),
    isTest: testStatusMatcher(Object.values(settings.projects).flatMap((p) => p.inTest.map((s) => s.id))),
  };
}

export type WeeklyReportResponse = { report: WeekReport; previous: WeekTotals; saved?: SavedWeek; currentWeek: string };

export async function getWeeklyReport(ctx: Context, week: string, now = new Date()): Promise<WeeklyReportResponse> {
  const previousWeek = shiftWeek(week, -1);
  const data = await loadActivity(ctx, weekRange(previousWeek).start, weekRange(week).end);
  const saved = (await ctx.weeklyReports.read()).weeks[week];
  return { report: buildWeekReport(week, data), previous: buildWeekReport(previousWeek, data).totals, saved, currentWeek: weekIdOf(now) };
}

export type HistoryWeek = { week: string; totals: WeekTotals; saved?: { savedAt: string; sentAt?: string } };

/** Son `HISTORY_WEEKS` haftanın sayıları (en eski başta; sonuncusu içinde bulunulan hafta). */
export async function getWeeklyHistory(ctx: Context, now = new Date()): Promise<{ weeks: HistoryWeek[]; currentWeek: string }> {
  const currentWeek = weekIdOf(now);
  const weeks = recentWeeks(currentWeek, HISTORY_WEEKS);
  const data = await loadActivity(ctx, weekRange(weeks[0]!).start, weekRange(currentWeek).end);
  const saved = (await ctx.weeklyReports.read()).weeks;
  return {
    currentWeek,
    weeks: weeks.map((week) => {
      const s = saved[week];
      return { week, totals: buildWeekReport(week, data).totals, saved: s ? { savedAt: s.savedAt, sentAt: s.sentAt } : undefined };
    }),
  };
}

/**
 * Notu ve o anki sayıları kaydeder; Jira'ya yazmaz. Sayılar Jira'dan okunamazsa (ağ, VPN) not yine kaydedilir,
 * önceki sayılar korunur.
 */
export async function saveWeek(ctx: Context, week: string, note: string, now = new Date()): Promise<SavedWeek> {
  const totals = await getWeeklyReport(ctx, week, now).then(
    (r) => r.report.totals,
    (error: unknown) => {
      console.warn("[weekly] Sayılar Jira'dan okunamadı; yalnızca not kaydediliyor.", error instanceof Error ? error.message : error);
      return undefined;
    },
  );
  const doc = await ctx.weeklyReports.update((s) => ({
    weeks: { ...s.weeks, [week]: { ...s.weeks[week], note, savedAt: now.toISOString(), totals: totals ?? s.weeks[week]?.totals } },
  }));
  return doc.weeks[week]!;
}

/** Raporu Teams'e gönderir; gönderim bilgisini (ve notu) kayda işler. */
export async function sendWeekToTeams(ctx: Context, week: string, note: string, selection: TeamsSelection, now = new Date()): Promise<SavedWeek> {
  const settings = await ctx.settings.read();
  // Hedef, Jira'dan okumadan önce doğrulanır.
  const resolved = resolveTeamsTarget(settings, selection);
  const [{ report }, me] = await Promise.all([getWeeklyReport(ctx, week, now), ctx.myself()]);
  const jiraBaseUrl = ctx.env.JIRA_BASE_URL;
  await deliverTeamsCard(
    resolved,
    weeklyReportCard({
      title: `Hafta ${weekNumber(week)} · ${weekLabel(week)}`,
      person: me.displayName,
      totals: report.totals,
      closed: report.lists.closed,
      bugs: report.lists.bugs,
      note,
      jiraBaseUrl,
    }),
  );
  const at = now.toISOString();
  const doc = await ctx.weeklyReports.update((s) => ({
    weeks: {
      ...s.weeks,
      [week]: { ...s.weeks[week], note, savedAt: at, totals: report.totals, sentAt: at, sentTo: teamsTargetLabel(resolved.target).slice(0, 120) },
    },
  }));
  return doc.weeks[week]!;
}
