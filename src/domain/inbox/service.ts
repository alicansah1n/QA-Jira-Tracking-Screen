import "server-only";
import type { AnalysisStore } from "@/domain/analysis/store";
import { rowFields, toIssueRow, type IssueRow } from "@/domain/issues/row";
import { searchAll } from "@/lib/jira/api";
import { addComment, findCommentsWithProperty, getIssueProperty, setIssueProperty } from "@/lib/jira/operations";
import { JiraSchemaError, JiraUnknownOutcomeError } from "@/lib/jira/errors";
import type { Context } from "@/lib/server/context";
import {
  COMMENT_MARKER_PROPERTY,
  DEV_REQUEST_PROPERTY,
  devRequestAdf,
  devRequestEligibility,
  devRequestText,
  type DevRequestEligibility,
} from "./dev-request";
import { STALE_SENDING_MS, type LedgerEntry } from "./ledger";

export const INBOX_JQL = "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";
const NEW_WINDOW_MS = 24 * 60 * 60_000;

export type AnalysisState = "none" | "ok" | "stale" | "invalid";

export type InboxItem = IssueRow & {
  isNew: boolean;
  analysis: { state: AnalysisState; testCases?: number; overview?: string };
  devRequest: { eligibility: DevRequestEligibility; ledger?: LedgerEntry; preview?: string };
};

export type InboxResult = { items: InboxItem[]; developerFieldMapped: boolean; fetchedAt: string };

export async function listInbox(ctx: Context, analyses: AnalysisStore, now = new Date()): Promise<InboxResult> {
  await ctx.myself();
  const settings = await ctx.settings.read();
  const custom = { developer: settings.fields.developer?.id, testAssignee: settings.fields.testAssignee?.id };
  const issues = await searchAll(ctx.jira, INBOX_JQL, { fields: rowFields(custom), maxIssues: 1000 });
  const rows = issues.map((i) => toIssueRow(i, custom));

  // İlk görülme zamanı kaydedilir; son 24 saatte ilk kez görülenler "yeni" sayılır.
  const nowIso = now.toISOString();
  const seen = await ctx.inboxSeen.update((s) => {
    const next = { ...s.seen };
    for (const r of rows) next[r.key] ??= nowIso;
    // Artık listede olmayanlar silinir; dosya büyümez.
    for (const key of Object.keys(next)) if (!rows.some((r) => r.key === key)) delete next[key];
    return { seen: next };
  });
  const ledger = await ctx.ledger.read();
  const entries = await analyses.list();
  const byKey = new Map(entries.map((e) => [e.key, e]));

  const items = rows.map((row): InboxItem => {
    const firstSeen = seen.seen[row.key];
    const entry = byKey.get(row.key);
    const analysis: InboxItem["analysis"] = !entry
      ? { state: "none" }
      : !entry.ok
        ? { state: "invalid" }
        : {
            state: isStale(entry.analysis.issue.updated, row.updated) ? "stale" : "ok",
            testCases: entry.analysis.testCases.length,
            overview: entry.analysis.summary.overview,
          };
    const eligibility = devRequestEligibility(row, Boolean(custom.developer));
    return {
      ...row,
      isNew: firstSeen ? now.getTime() - Date.parse(firstSeen) < NEW_WINDOW_MS : true,
      analysis,
      devRequest: {
        eligibility,
        ledger: ledger.entries[row.key],
        preview: eligibility.eligible ? devRequestText(eligibility.developers) : undefined,
      },
    };
  });
  return { items, developerFieldMapped: Boolean(custom.developer), fetchedAt: nowIso };
}

/** Analiz, maddenin analiz edildiği sürümden sonra güncellendiyse eskimiştir. */
export function isStale(analyzedUpdated: string | undefined, currentUpdated: string | undefined): boolean {
  if (!analyzedUpdated || !currentUpdated) return false;
  const a = Date.parse(analyzedUpdated);
  const c = Date.parse(currentUpdated);
  return !Number.isNaN(a) && !Number.isNaN(c) && c > a;
}

export type SendResult = { key: string; outcome: "sent" | "already-sent" | "skipped" | "unknown" | "failed"; message?: string };

/**
 * Bilgi talebini gönderir. Sıra: defter → kuralın taze veriyle tekrar kontrolü → Jira işareti kontrolü →
 * yorum (görünmez işaretle) → Jira işareti → defter. Sonucu bilinmeyen yazma doğrulanmadan tekrarlanmaz.
 */
export async function sendDevRequest(
  ctx: Context,
  key: string,
  /** Önizlemede gösterilen developer accountId'leri; değiştiyse gönderilmez. */
  expectedDevelopers?: readonly string[],
  now = () => new Date(),
): Promise<SendResult> {
  // Gönderim hakkı tek bir defter güncellemesiyle alınır: aynı anda gelen iki istekten yalnızca biri geçer.
  let decision = "proceed" as "proceed" | "already-sent" | "in-progress";
  let resuming = false;
  await ctx.ledger.update((l) => {
    const cur = l.entries[key];
    if (cur?.state === "sent") {
      decision = "already-sent";
      return l;
    }
    if (cur?.state === "sending" && now().getTime() - Date.parse(cur.at) < STALE_SENDING_MS) {
      decision = "in-progress";
      return l;
    }
    resuming = cur?.state === "sending" || cur?.state === "unknown";
    return { entries: { ...l.entries, [key]: { state: "sending", at: now().toISOString() } } };
  });
  if (decision === "already-sent") return { key, outcome: "already-sent" };
  if (decision === "in-progress") return { key, outcome: "unknown", message: "Gönderim zaten sürüyor" };

  try {
    // 1) Daha önce (başka bir cihazdan/denemeden) gönderilmiş mi?
    const marker = await getIssueProperty<{ commentId?: string }>(ctx.jira, key, DEV_REQUEST_PROPERTY);
    if (marker) {
      await setLedger(ctx, key, { state: "sent", at: now().toISOString(), commentId: marker.commentId });
      return { key, outcome: "already-sent" };
    }
    if (resuming) {
      const existing = await findMarkedComment(ctx, key);
      if (existing) return await finish(ctx, key, existing, now);
    }

    // 2) Kural hâlâ geçerli mi? (bu arada component ya da yorum eklenmiş olabilir)
    const settings = await ctx.settings.read();
    const custom = { developer: settings.fields.developer?.id, testAssignee: settings.fields.testAssignee?.id };
    // Yalnızca bana atanmış açık maddeler: gelen kutusu dışındaki bir maddeye yorum atılmaz.
    const [issue] = await searchAll(ctx.jira, `key = "${key}" AND assignee = currentUser() AND statusCategory != Done`, {
      fields: rowFields(custom),
      maxIssues: 1,
    });
    if (!issue) {
      await setLedger(ctx, key, { state: "skipped", at: now().toISOString(), error: "not-in-inbox" });
      return { key, outcome: "skipped", message: "Madde artık size atanmış açık bir madde değil" };
    }
    const eligibility = devRequestEligibility(toIssueRow(issue, custom), Boolean(custom.developer));
    if (!eligibility.eligible) {
      await setLedger(ctx, key, { state: "skipped", at: now().toISOString(), error: eligibility.reason });
      return { key, outcome: "skipped", message: "Madde artık kurala uymuyor" };
    }
    if (expectedDevelopers) {
      const same = (a: readonly string[], b: readonly string[]) => [...a].sort().join() === [...b].sort().join();
      if (!same(expectedDevelopers, eligibility.developers.map((d) => d.accountId))) {
        // Kuyrukta yeniden görünsün: kayıt silinir.
        await ctx.ledger.update((l) => {
          const entries = { ...l.entries };
          delete entries[key];
          return { entries };
        });
        return { key, outcome: "skipped", message: "Developer alanı değişmiş; listeyi yenileyip tekrar onaylayın" };
      }
    }

    // 3) Yorum
    let commentId: string;
    try {
      const comment = await addComment(ctx.jira, key, devRequestAdf(eligibility.developers), [
        { key: COMMENT_MARKER_PROPERTY, value: { kind: "dev-request", at: now().toISOString() } },
      ]);
      commentId = comment.id;
    } catch (error) {
      if (error instanceof JiraUnknownOutcomeError || (error instanceof JiraSchemaError && error.committed)) {
        const existing = await findMarkedComment(ctx, key).catch(() => undefined);
        if (existing) return await finish(ctx, key, existing, now);
        await setLedger(ctx, key, { state: "unknown", at: now().toISOString(), error: "Sonuç doğrulanamadı" });
        return { key, outcome: "unknown", message: "Yorumun gönderilip gönderilmediği doğrulanamadı; tekrar denediğinizde önce kontrol edilir." };
      }
      throw error;
    }
    return await finish(ctx, key, commentId, now);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bilinmeyen hata";
    await setLedger(ctx, key, { state: "failed", at: now().toISOString(), error: message });
    return { key, outcome: "failed", message };
  }
}

async function finish(ctx: Context, key: string, commentId: string, now: () => Date): Promise<SendResult> {
  // İşaret yazılamasa bile yorum gönderilmiştir; defter "sent" olur.
  await setIssueProperty(ctx.jira, key, DEV_REQUEST_PROPERTY, { commentId, at: now().toISOString() }).catch(() => undefined);
  await setLedger(ctx, key, { state: "sent", at: now().toISOString(), commentId });
  return { key, outcome: "sent" };
}

async function findMarkedComment(ctx: Context, key: string): Promise<string | undefined> {
  const ids = await findCommentsWithProperty(
    ctx.jira,
    key,
    COMMENT_MARKER_PROPERTY,
    (v) => typeof v === "object" && v !== null && (v as { kind?: unknown }).kind === "dev-request",
  );
  return ids[0];
}

function setLedger(ctx: Context, key: string, entry: LedgerEntry) {
  return ctx.ledger.update((l) => ({ entries: { ...l.entries, [key]: entry } }));
}
