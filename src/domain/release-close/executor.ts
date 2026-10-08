import "server-only";
import { randomBytes } from "node:crypto";
import { doc, paragraph, strong, text } from "@/lib/jira/adf/build";
import { JiraError, JiraSchemaError, JiraUnknownOutcomeError } from "@/lib/jira/errors";
import {
  addComment,
  deleteComment,
  findCommentsWithProperty,
  getIssueStatus,
  getTransitions,
  getVersion,
  setVersionReleased,
  transitionIssue,
} from "@/lib/jira/operations";
import { releaseClosedCard } from "@/lib/teams/cards";
import { sendTeamsCard } from "@/lib/teams/webhook";
import type { Context } from "@/lib/server/context";
import { buildReleasePlan, type ReleasePlan } from "./preflight";
import type { Journal, JournalStep } from "./journal";

export const RELEASE_COMMENT_PROPERTY = "qa-assistant";

export class ReleaseCloseError extends Error {
  // Next aynı modülü farklı paketlerde (sayfa / route) ayrı kopyalar olarak yükleyebilir; o zaman
  // `instanceof` kopyalar arasında tutmaz. Kontrol sınıf adına göre yapılır.
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null && (value as { name?: unknown }).name === "ReleaseCloseError";
  }

  constructor(
    readonly code: "BLOCKED" | "DRIFT" | "BUSY",
    message: string,
    readonly details?: string[],
  ) {
    super(message);
    this.name = "ReleaseCloseError";
  }
}

const holder = globalThis as unknown as { __qaReleaseRunning?: boolean };

const isUncertain = (e: unknown) => e instanceof JiraUnknownOutcomeError || (e instanceof JiraSchemaError && e.committed);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const nowIso = () => new Date().toISOString();

export function releaseCommentAdf(versionName: string, date: string) {
  return doc(
    paragraph(text("✅ Bu madde "), strong(versionName), text(` release'i ile ${date} tarihinde canlıya alınmıştır.`)),
    paragraph(text("Statü otomatik olarak güncellendi.")),
  );
}

const isOurComment = (runId: string) => (v: unknown) =>
  typeof v === "object" && v !== null && (v as { kind?: unknown; runId?: unknown }).kind === "release-close" && (v as { runId?: unknown }).runId === runId;

/** Çalışan ya da yarıda kalmış bir kapatma var mı? */
export async function activeJournals(ctx: Context): Promise<Journal[]> {
  const ids = await ctx.listJournalIds();
  const all = await Promise.all(ids.map((id) => ctx.journal(id).read().catch(() => null)));
  return all.filter((j): j is Journal => j !== null && needsAttention(j));
}

/** Yarıda kalmış ya da geri alması eksik kalmış (ve kullanıcının henüz kapatmadığı) kayıt. */
export function needsAttention(j: Journal): boolean {
  return j.state === "running" || j.state === "rolling_back" || (j.state === "rollback_failed" && !j.acknowledgedAt);
}

/** Geri alması eksik kalmış kaydı, kullanıcı Jira'yı elle düzelttiğini onaylayınca kapatır. */
export async function acknowledgeJournal(ctx: Context, runId: string): Promise<Journal> {
  const j = await ctx.journal(runId).read();
  if (!j) throw new Error("Kayıt bulunamadı");
  if (j.state !== "rollback_failed") throw new ReleaseCloseError("BLOCKED", "Yalnızca geri alması eksik kalan kayıtlar kapatılabilir.");
  return (await ctx.journal(runId).update((cur) => ({ ...cur!, acknowledgedAt: nowIso() })))!;
}

export async function listJournals(ctx: Context, limit = 20): Promise<Journal[]> {
  const ids = await ctx.listJournalIds();
  const all = await Promise.all(ids.map((id) => ctx.journal(id).read().catch(() => null)));
  return all
    .filter((j): j is Journal => j !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}

/**
 * Release'i kapatır: ya hepsi ya hiçbiri. Onay anında plan yeniden hesaplanır; önizlemedeki parmak izi
 * tutmazsa (statü değişti, madde eklendi/çıkarıldı) hiçbir şey yapılmaz.
 */
export async function executeReleaseClose(
  ctx: Context,
  versionId: string,
  expectedFingerprint: string,
  teamsTargetId: string | null,
): Promise<Journal> {
  // Bayrak ilk `await`'ten önce, eşzamanlı olarak alınır; aksi halde aynı anda gelen iki istek
  // kontrolü birlikte geçip aynı release'i iki kez işleyebilirdi.
  if (holder.__qaReleaseRunning) throw busy();
  holder.__qaReleaseRunning = true;
  try {
    if ((await activeJournals(ctx)).length) throw busy();
    const plan = await buildReleasePlan(ctx, versionId);
    if (!plan.canExecute || !plan.statuses) throw new ReleaseCloseError("BLOCKED", "Release kapatmaya uygun değil.", plan.blockers);
    if (plan.fingerprint !== expectedFingerprint) {
      throw new ReleaseCloseError("DRIFT", "Önizlemeden sonra Jira'da değişiklik oldu (statü ya da release içeriği). Önizlemeyi yenileyin.");
    }
    const journal = await run(ctx, plan);
    if (journal.state !== "committed" || !teamsTargetId) return journal;
    // Jira tamamlandı; bildirim hatası (ör. hedef silinmiş) sonucu "başarısız"a çevirmemeli.
    try {
      return await notifyRelease(ctx, journal.runId, teamsTargetId);
    } catch (error) {
      return (await ctx.journal(journal.runId).update((cur) => ({
        ...cur!,
        notifications: [...cur!.notifications, { targetId: teamsTargetId, targetName: "?", at: nowIso(), ok: false, error: message(error) }],
      })))!;
    }
  } finally {
    holder.__qaReleaseRunning = false;
  }
}

function busy() {
  return new ReleaseCloseError("BUSY", "Devam eden ya da yarıda kalmış bir release kapatma işlemi var. Önce onu tamamlayın.");
}

/** Bu süreçte şu an bir kapatma çalışıyor mu? (Yarıda kalmış kayıtla karıştırılmamalı.) */
export function isReleaseCloseRunning(): boolean {
  return Boolean(holder.__qaReleaseRunning);
}

/** Bu süreden yeni adım yazmış bir kayıt, başka bir süreçte hâlâ çalışıyor olabilir. */
const LIVE_WINDOW_MS = 2 * 60_000;

function lastActivity(j: Journal): number {
  return Math.max(Date.parse(j.startedAt), ...j.steps.map((s) => Date.parse(s.at)).filter((n) => !Number.isNaN(n)));
}

/**
 * Kullanıcının başlattığı geri alma: yalnızca gerçekten yarıda kalmış kayıtlar için. Çalışan bir
 * kapatmanın altından geri alma başlatılırsa Jira yarı geri alınmış halde kalırdı.
 */
export async function rollbackInterrupted(ctx: Context, runId: string, now = Date.now()): Promise<Journal> {
  if (holder.__qaReleaseRunning) throw new ReleaseCloseError("BUSY", "Bir release kapatma şu an çalışıyor; bitmesini bekleyin.");
  const j = await ctx.journal(runId).read();
  if (!j) throw new Error("Kayıt bulunamadı");
  if (!needsAttention(j)) throw new ReleaseCloseError("BLOCKED", "Bu kayıt için geri alma gerekmiyor.");
  if (j.state === "running" && now - lastActivity(j) < LIVE_WINDOW_MS) {
    throw new ReleaseCloseError("BUSY", "Bu işlem birkaç dakika önce adım yazmış; başka bir pencerede hâlâ çalışıyor olabilir. Biraz bekleyip tekrar deneyin.");
  }
  holder.__qaReleaseRunning = true;
  try {
    return await rollbackJournal(ctx, runId);
  } finally {
    holder.__qaReleaseRunning = false;
  }
}

async function run(ctx: Context, plan: ReleasePlan): Promise<Journal> {
  const statuses = plan.statuses!;
  const runId = `rc-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  const store = ctx.journal(runId);
  const initial: Journal = {
    runId,
    versionId: plan.version.id,
    versionName: plan.version.name,
    projectKey: plan.project.key,
    releaseDate: plan.releaseDate,
    originalVersion: { released: plan.version.released, releaseDate: plan.version.releaseDate },
    toBeDeployed: statuses.toBeDeployed,
    completed: statuses.completed,
    issues: plan.issues.map((i) => ({ key: i.key, summary: i.summary, action: i.action === "transition" ? "transition" : "none" })),
    state: "running",
    steps: [],
    notifications: [],
    startedAt: nowIso(),
  };
  await store.update(() => initial);

  // Her adım önce "pending" yazılır; Jira'ya gidilir; sonuç yazılır.
  const begin = async (step: Omit<JournalStep, "state" | "at">) => {
    const j = await store.update((cur) => ({ ...cur!, steps: [...cur!.steps, { ...step, state: "pending", at: nowIso() }] }));
    return j!.steps.length - 1;
  };
  const finish = (index: number, patch: Partial<JournalStep>) =>
    store.update((cur) => ({ ...cur!, steps: cur!.steps.map((s, i) => (i === index ? { ...s, ...patch, at: nowIso() } : s)) }));

  try {
    for (const issue of plan.issues.filter((i) => i.action === "transition")) {
      // Son an kontrolü: madde hâlâ To be Deployed mı?
      const current = await getIssueStatus(ctx.jira, issue.key);
      if (current.id !== statuses.toBeDeployed.id) {
        throw new Error(`${issue.key} statüsü işlem sırasında değişti (${current.name}).`);
      }

      const t = await begin({ kind: "transition", issueKey: issue.key });
      try {
        await transitionIssue(ctx.jira, issue.key, issue.transitionId!);
        await finish(t, { state: "done" });
      } catch (error) {
        if (!isUncertain(error)) {
          await finish(t, { state: "failed", error: message(error) });
          throw error;
        }
        const after = await getIssueStatus(ctx.jira, issue.key).catch(() => undefined);
        if (after?.id !== statuses.completed.id) {
          await finish(t, { state: "unknown", error: message(error) });
          throw error;
        }
        await finish(t, { state: "done" });
      }

      const c = await begin({ kind: "comment", issueKey: issue.key });
      try {
        const comment = await addComment(ctx.jira, issue.key, releaseCommentAdf(plan.version.name, plan.releaseDate), [
          { key: RELEASE_COMMENT_PROPERTY, value: { kind: "release-close", runId } },
        ]);
        await finish(c, { state: "done", commentId: comment.id });
      } catch (error) {
        if (!isUncertain(error)) {
          await finish(c, { state: "failed", error: message(error) });
          throw error;
        }
        const ids = await findCommentsWithProperty(ctx.jira, issue.key, RELEASE_COMMENT_PROPERTY, isOurComment(runId)).catch(() => []);
        if (!ids[0]) {
          await finish(c, { state: "unknown", error: message(error) });
          throw error;
        }
        await finish(c, { state: "done", commentId: ids[0] });
      }
    }

    const r = await begin({ kind: "release" });
    try {
      await setVersionReleased(ctx.jira, plan.version.id, true, plan.releaseDate);
      await finish(r, { state: "done" });
    } catch (error) {
      if (!isUncertain(error)) {
        await finish(r, { state: "failed", error: message(error) });
        throw error;
      }
      const v = await getVersion(ctx.jira, plan.version.id).catch(() => undefined);
      if (!v?.released) {
        await finish(r, { state: "unknown", error: message(error) });
        throw error;
      }
      await finish(r, { state: "done" });
    }

    // Kayıt bu arada başka bir yoldan geri alındıysa "committed" ile ezilmez.
    const committed = await store.update((cur) => (cur!.state === "running" ? { ...cur!, state: "committed", finishedAt: nowIso() } : cur));
    if (committed!.state !== "committed") throw new Error("Kapatma sırasında kayıt başka bir işlemle değiştirildi.");
    return committed!;
  } catch (error) {
    await store.update((cur) => ({ ...cur!, state: "rolling_back", error: cur!.error ?? message(error) }));
    return rollbackJournal(ctx, runId);
  }
}

/**
 * Günlükteki yapılmış (ya da sonucu belirsiz) adımları ters sırayla geri alır. Her adım Jira'nın gerçek
 * durumuna bakılarak geri alınır; geri alınamayan adım "rollback_failed" olarak işaretlenir.
 */
export async function rollbackJournal(ctx: Context, runId: string): Promise<Journal> {
  const store = ctx.journal(runId);
  const journal = await store.read();
  if (!journal) throw new Error("Kayıt bulunamadı");
  if (journal.state === "committed" || journal.state === "rolled_back") return journal;
  await store.update((cur) => ({ ...cur!, state: "rolling_back" }));

  const steps = journal.steps.map((s, i) => ({ s, i })).reverse();
  for (const { s, i } of steps) {
    if (s.state === "rolled_back" || s.state === "failed" || s.state === "skipped") continue;
    let patch: Partial<JournalStep>;
    try {
      patch = await undoStep(ctx, journal, s);
    } catch (error) {
      patch = { state: "rollback_failed", error: undoError(error) };
    }
    await store.update((cur) => ({ ...cur!, steps: cur!.steps.map((x, k) => (k === i ? { ...x, ...patch, at: nowIso() } : x)) }));
  }

  return (await store.update((cur) => ({
    ...cur!,
    state: cur!.steps.some((x) => x.state === "rollback_failed") ? "rollback_failed" : "rolled_back",
    finishedAt: nowIso(),
  })))!;
}

async function undoStep(ctx: Context, journal: Journal, step: JournalStep): Promise<Partial<JournalStep>> {
  if (step.kind === "release") {
    const v = await getVersion(ctx.jira, journal.versionId);
    const original = journal.originalVersion;
    if (v.released || (original?.releaseDate && v.releaseDate !== original.releaseDate)) {
      await setVersionReleased(ctx.jira, journal.versionId, original?.released ?? false, original?.releaseDate);
    }
    return { state: "rolled_back" };
  }
  const key = step.issueKey!;
  if (step.kind === "comment") {
    const ids = step.commentId
      ? [step.commentId]
      : await findCommentsWithProperty(ctx.jira, key, RELEASE_COMMENT_PROPERTY, isOurComment(journal.runId));
    for (const id of ids) {
      await deleteComment(ctx.jira, key, id).catch((e) => {
        if (!(e instanceof JiraError && e.status === 404)) throw e;
      });
    }
    return { state: "rolled_back" };
  }
  // transition
  const status = await getIssueStatus(ctx.jira, key);
  if (status.id === journal.toBeDeployed.id) return { state: "rolled_back" };
  if (status.id !== journal.completed.id) {
    return { state: "rollback_failed", error: `Madde beklenmeyen statüde (${status.name}); elle kontrol edin.` };
  }
  const back = (await getTransitions(ctx.jira, key)).find((t) => t.to.id === journal.toBeDeployed.id);
  if (!back) return { state: "rollback_failed", error: `${journal.completed.name} → ${journal.toBeDeployed.name} geçişi yok; statüyü elle geri alın.` };
  await transitionIssue(ctx.jira, key, back.id);
  return { state: "rolled_back" };
}

function undoError(error: unknown): string {
  if (isUncertain(error)) return "Jira zamanında cevap vermedi; durumu elle kontrol edin.";
  return message(error);
}

/** Başarıyla kapatılmış release'i Teams'e bildirir. Hata Jira'yı etkilemez; tekrar denenebilir. */
export async function notifyRelease(ctx: Context, runId: string, targetId: string): Promise<Journal> {
  const store = ctx.journal(runId);
  const journal = await store.read();
  if (!journal || journal.state !== "committed") throw new Error("Yalnızca tamamlanmış kapatmalar bildirilebilir");
  const settings = await ctx.settings.read();
  const target = settings.teams.targets.find((t) => t.id === targetId);
  if (!target) throw new Error("Teams hedefi bulunamadı");
  const me = await ctx.myself().catch(() => undefined);
  const base = ctx.env.JIRA_BASE_URL;
  let ok = true;
  let error: string | undefined;
  try {
    await sendTeamsCard(
      target.url,
      releaseClosedCard({
        projectName: settings.projects[journal.projectKey]?.name ?? journal.projectKey,
        versionName: journal.versionName,
        releaseDate: journal.releaseDate,
        closedBy: me?.displayName ?? "QA Asistanı",
        transitioned: journal.issues.filter((i) => i.action === "transition"),
        untouched: journal.issues.filter((i) => i.action === "none").length,
        jiraBaseUrl: base,
        versionUrl: `${base}/projects/${encodeURIComponent(journal.projectKey)}/versions/${encodeURIComponent(journal.versionId)}`,
      }),
    );
  } catch (e) {
    ok = false;
    error = message(e);
  }
  return (await store.update((cur) => ({
    ...cur!,
    notifications: [...cur!.notifications, { targetId, targetName: target.name, at: nowIso(), ok, error }],
  })))!;
}
