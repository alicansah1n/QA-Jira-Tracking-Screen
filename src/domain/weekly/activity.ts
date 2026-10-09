import { isCanceledStatus, isPausedStatus } from "@/domain/issues/stage";
import { localDay, weekRange } from "./week";

/**
 * Haftalık rapor: kullanıcının Jira'daki statü geçişlerinden "ne yaptım" çıkarımı. Saf fonksiyonlar;
 * Jira'dan okuma `service.ts`'tedir.
 *
 * Gerçek veride (OZE) worklog kullanılmıyor; efor, madde kapanırken doldurulan StoryPointTest alanıdır.
 * Test akışı: Coding → Test → (Completed | To be Deployed | Paused | Coding).
 */

export type StatusInfo = { name: string; category: string };

export type ActivityIssue = {
  id: string;
  key: string;
  summary: string;
  type?: { name: string; iconUrl?: string };
  status: { name: string; category: string };
  release?: string;
  /** StoryPointTest (Ayarlar'daki alan eşlemesinden). */
  effort?: number;
};

export type StatusEvent = { issueId: string; at: number; from?: string; to?: string; byMe: boolean };
export type AssignEvent = { issueId: string; at: number };
export type BugIssue = ActivityIssue & { created: string };

export type ActivityData = {
  issues: Map<string, ActivityIssue>;
  statusEvents: StatusEvent[];
  /** Bana atanma anları (atayan kim olursa olsun). */
  assignEvents: AssignEvent[];
  /** Benim açtığım Bug'lar. */
  bugs: BugIssue[];
  statuses: Map<string, StatusInfo>;
  isTest: (s: { id: string; name: string }) => boolean;
};

/**
 * - closed: madde benim geçişimle "done" kategorisine girdi (Completed, To be Deployed…). done → done (ör.
 *   release kapatırken To be Deployed → Completed) yeniden sayılmaz; iptal statüleri kapanış değildir.
 * - returned: testteki maddeyi geliştirmeye geri gönderdim (Test → Coding / New).
 * - paused: beklemeye aldım (→ Paused).
 * - started: teste aldım ya da işe başladım (New → In Progress gibi).
 */
export type EventKind = "closed" | "returned" | "paused" | "started";

export function classifyTransition(from: string | undefined, to: string | undefined, data: Pick<ActivityData, "statuses" | "isTest">): EventKind | null {
  const f = from ? data.statuses.get(from) : undefined;
  const t = to ? data.statuses.get(to) : undefined;
  if (!t || !to) return null;
  const fromTest = Boolean(f && from && data.isTest({ id: from, name: f.name }));
  const toTest = data.isTest({ id: to, name: t.name });
  if (t.category === "done") return f?.category === "done" || isCanceledStatus(t.name) ? null : "closed";
  // Sıra panodaki `stageOf` ile aynı: "testte" eşlemesi ada göre beklemede tanımadan önce gelir.
  if (toTest) return fromTest ? null : "started";
  if (isPausedStatus(t.name)) return f && isPausedStatus(f.name) && !fromTest ? null : "paused";
  if (fromTest) return "returned";
  if (f?.category === "new" && t.category === "indeterminate") return "started";
  return null;
}

export type ReportItem = {
  key: string;
  summary: string;
  type?: { name: string; iconUrl?: string };
  status: { name: string; category: string };
  release?: string;
  effort?: number;
  /** Olayın zamanı (ISO). */
  at: string;
  /** Geçiş, ör. "Test → Paused". */
  transition?: string;
};

export type WeekTotals = {
  closed: number;
  /** Kapattığım maddelerin StoryPointTest toplamı. */
  effort: number;
  /** Kapattığım ama StoryPointTest'i boş maddeler. */
  missingEffort: number;
  returned: number;
  paused: number;
  started: number;
  bugs: number;
  received: number;
  /** Benim yaptığım tüm statü geçişleri. */
  moves: number;
};

export const LIST_KEYS = ["closed", "bugs", "returned", "paused", "started", "received"] as const;
export type ListKey = (typeof LIST_KEYS)[number];

export type WeekReport = {
  week: string;
  start: string;
  end: string;
  totals: WeekTotals;
  /** Pazartesi → Pazar, benim statü geçişlerimin sayısı. */
  days: { date: string; moves: number; closed: number }[];
  lists: Record<ListKey, ReportItem[]>;
};

const round = (n: number) => Math.round(n * 100) / 100;

export function buildWeekReport(week: string, data: ActivityData): WeekReport {
  const { start, end } = weekRange(week);
  const from = start.getTime();
  const to = end.getTime();
  const inWeek = (t: number) => t >= from && t < to;

  const days = Array.from({ length: 7 }, (_, i) => ({ date: localDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)), moves: 0, closed: 0 }));
  const dayIndex = new Map(days.map((d, i) => [d.date, i]));

  // Her tür için maddenin o haftadaki son olayı tutulur (aynı madde iki kez beklemeye alındıysa bir kez sayılır).
  const latest: Record<EventKind, Map<string, StatusEvent>> = { closed: new Map(), returned: new Map(), paused: new Map(), started: new Map() };
  let moves = 0;
  for (const e of data.statusEvents) {
    if (!e.byMe || !inWeek(e.at)) continue;
    moves++;
    const kind = classifyTransition(e.from, e.to, data);
    const day = days[dayIndex.get(localDay(new Date(e.at))) ?? -1];
    if (day) day.moves++;
    if (!kind) continue;
    const prev = latest[kind].get(e.issueId);
    if (!prev || e.at > prev.at) latest[kind].set(e.issueId, e);
  }

  const statusName = (id: string | undefined) => (id ? (data.statuses.get(id)?.name ?? "?") : "?");
  const item = (issue: ActivityIssue, at: number, transition?: string): ReportItem => ({
    key: issue.key,
    summary: issue.summary,
    type: issue.type,
    status: issue.status,
    release: issue.release,
    effort: issue.effort,
    at: new Date(at).toISOString(),
    transition,
  });
  const listOf = (kind: EventKind) =>
    [...latest[kind].values()]
      .flatMap((e) => {
        const issue = data.issues.get(e.issueId);
        return issue ? [item(issue, e.at, `${statusName(e.from)} → ${statusName(e.to)}`)] : [];
      })
      .sort((a, b) => b.at.localeCompare(a.at));

  const receivedAt = new Map<string, number>();
  for (const e of data.assignEvents) if (inWeek(e.at) && (receivedAt.get(e.issueId) ?? 0) < e.at) receivedAt.set(e.issueId, e.at);
  const received = [...receivedAt]
    .flatMap(([id, at]) => {
      const issue = data.issues.get(id);
      return issue ? [item(issue, at)] : [];
    })
    .sort((a, b) => b.at.localeCompare(a.at));

  const bugs = data.bugs
    .filter((b) => inWeek(Date.parse(b.created)))
    .map((b) => item(b, Date.parse(b.created)))
    .sort((a, b) => b.at.localeCompare(a.at));

  const closed = listOf("closed");
  // Günlük kapanış, toplamla tutarlı olsun diye maddenin haftadaki son kapanışından sayılır.
  for (const e of latest.closed.values()) {
    const day = days[dayIndex.get(localDay(new Date(e.at))) ?? -1];
    if (day) day.closed++;
  }
  const lists: WeekReport["lists"] = { closed, bugs, returned: listOf("returned"), paused: listOf("paused"), started: listOf("started"), received };
  return {
    week,
    start: start.toISOString(),
    end: end.toISOString(),
    totals: {
      closed: closed.length,
      effort: round(closed.reduce((n, i) => n + (i.effort ?? 0), 0)),
      missingEffort: closed.filter((i) => i.effort === undefined).length,
      returned: lists.returned.length,
      paused: lists.paused.length,
      started: lists.started.length,
      bugs: bugs.length,
      received: received.length,
      moves,
    },
    days,
    lists,
  };
}
