import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { IssueAnalysis } from "@/domain/analysis/schema";
import { renderReport, reportFilename } from "@/domain/report/html";
import { TEAMS_ID_PATTERN, TeamsContactIdsSchema } from "@/domain/settings/schema";
import { CASE_STATUS_LABELS, VERDICT_LABELS, emptyRun, summarizeRun, type TestRun } from "@/domain/testrun/schema";
import { plainTextToAdf } from "@/lib/jira/adf/build";
import { JiraError, JiraSchemaError, JiraUnknownOutcomeError } from "@/lib/jira/errors";
import {
  addAttachment,
  addComment,
  findCommentsWithProperty,
  getEditMeta,
  listAttachments,
  getTransitions,
  transitionIssue,
  updateIssueFields,
} from "@/lib/jira/operations";
import type { Context } from "@/lib/server/context";

export const CloseInputSchema = z.object({
  testAssignee: z.object({ accountId: z.string().min(1), displayName: z.string() }).nullable(),
  storyPointTest: z.number().min(0).max(1000).nullable(),
  comment: z.string().trim().max(20_000),
  attachReport: z.boolean(),
  transitionId: z.string().nullable(),
  teamsTargetId: z.string().regex(TEAMS_ID_PATTERN).nullable().default(null),
  teamsContactIds: TeamsContactIdsSchema,
  /** Daha önce bu uygulamadan kapatılmış maddeyi bilerek yeniden kapatmak. */
  reclose: z.boolean().default(false),
});
export type CloseInput = z.infer<typeof CloseInputSchema>;

type FieldPlacement = "transition" | "edit" | "unavailable";

export type ClosePlan = {
  transitions: { id: string; name: string; to: string }[];
  steps: { kind: "attach" | "comment" | "fields" | "transition"; title: string; detail: string }[];
  blockers: string[];
  placements: { testAssignee?: FieldPlacement; storyPointTest?: FieldPlacement };
  /** Test Assignee çoklu kullanıcı alanıysa değer dizi olarak gönderilir. */
  testAssigneeMulti: boolean;
  fieldsMapped: { testAssignee: boolean; storyPointTest: boolean };
};

/** Varsayılan özet yorum: kullanıcı önizlemede düzenleyebilir. */
export function defaultCloseComment(analysis: IssueAnalysis, run: TestRun | undefined, reportName: string | undefined): string {
  const s = summarizeRun(analysis, run);
  const problems = analysis.testCases.filter((tc) => ["failed", "blocked"].includes(run?.results[tc.id]?.status ?? ""));
  const lines = [
    `Test tamamlandı — Sonuç: ${VERDICT_LABELS[s.verdict]}`,
    "",
    `Toplam ${s.total} test case: ${s.counts.passed} başarılı, ${s.counts.failed} başarısız, ${s.counts.blocked} bloke, ${s.counts.skipped} atlandı.`,
    ...(run?.environment ? [`Test ortamı: ${run.environment}`] : []),
  ];
  if (problems.length) {
    lines.push("", "Dikkat gerektirenler:");
    for (const tc of problems) {
      const r = run?.results[tc.id];
      lines.push(`- ${tc.id} ${tc.title} (${CASE_STATUS_LABELS[r?.status ?? "pending"]})${r?.note ? `: ${r.note}` : ""}`);
    }
  }
  if (reportName) lines.push("", `Detaylı rapor ekte: ${reportName}`);
  return lines.join("\n");
}

export async function planClose(ctx: Context, key: string, input: CloseInput): Promise<ClosePlan> {
  await ctx.myself();
  const run = (await ctx.run(key).read()) ?? undefined;
  const progress = run?.closedAt && input.reclose ? undefined : run?.closeProgress;
  const settings = await ctx.settings.read();
  const ta = settings.fields.testAssignee?.id;
  const sp = settings.fields.storyPointTest?.id;
  const [transitions, editMeta] = await Promise.all([getTransitions(ctx.jira, key), getEditMeta(ctx.jira, key)]);
  const blockers: string[] = [];
  if (run?.closedAt && !input.reclose) {
    blockers.push("Bu madde daha önce bu uygulamadan kapatılmış. Yine de tekrar yapmak istiyorsanız \"Tekrar kapat\" seçeneğini işaretleyin.");
  }
  const chosen = input.transitionId ? transitions.find((t) => t.id === input.transitionId) : undefined;
  if (input.transitionId && !chosen) blockers.push("Seçilen geçiş artık mevcut değil; listeyi yenileyin.");

  const place = (fieldId: string | undefined): FieldPlacement | undefined => {
    if (!fieldId) return undefined;
    if (chosen?.fields?.[fieldId]) return "transition";
    if (editMeta[fieldId]) return "edit";
    return "unavailable";
  };
  const placements = {
    testAssignee: input.testAssignee ? place(ta) : undefined,
    storyPointTest: input.storyPointTest !== null ? place(sp) : undefined,
  };
  if (input.testAssignee && !ta) blockers.push("Test Assignee alanı Ayarlar'da eşlenmemiş.");
  if (input.storyPointTest !== null && !sp) blockers.push("StoryPointTest alanı Ayarlar'da eşlenmemiş.");
  if (placements.testAssignee === "unavailable") blockers.push("Test Assignee alanı bu maddede düzenlenemiyor (ekranda yok ya da yetki yok).");
  if (placements.storyPointTest === "unavailable") blockers.push("StoryPointTest alanı bu maddede düzenlenemiyor (ekranda yok ya da yetki yok).");

  // Geçiş ekranındaki zorunlu alanlar: yalnızca bizim doldurduklarımız ya da varsayılanı olanlar kabul edilir.
  if (chosen) {
    const ours = new Set([placements.testAssignee === "transition" ? ta : undefined, placements.storyPointTest === "transition" ? sp : undefined]);
    for (const [fid, meta] of Object.entries(chosen.fields ?? {})) {
      if (meta.required && !meta.hasDefaultValue && !ours.has(fid)) {
        blockers.push(`"${chosen.name}" geçişi zorunlu "${meta.name ?? fid}" alanını istiyor; bu alan uygulamadan doldurulamıyor.`);
      }
    }
  }

  const steps: ClosePlan["steps"] = [];
  const skipped = " (önceki denemede yapıldı — tekrar gönderilmeyecek)";
  if (input.attachReport) {
    steps.push({ kind: "attach", title: "HTML raporu ekle", detail: `Sonuç raporu maddeye ek olarak yüklenir${progress?.attachmentId ? skipped : ""}` });
  }
  if (input.comment) {
    steps.push({ kind: "comment", title: "Özet yorum ekle", detail: `${input.comment.split("\n")[0]?.slice(0, 120) ?? ""}…${progress?.commentId ? skipped : ""}` });
  }
  const fieldParts = [
    input.testAssignee ? `Test Assignee → ${input.testAssignee.displayName}` : undefined,
    input.storyPointTest !== null ? `StoryPointTest → ${input.storyPointTest}` : undefined,
  ].filter(Boolean);
  if (fieldParts.length) steps.push({ kind: "fields", title: "Alanları doldur", detail: fieldParts.join(" · ") });
  if (chosen) steps.push({ kind: "transition", title: "Statüyü değiştir", detail: `${chosen.name} → ${chosen.to.name}` });
  if (steps.length === 0) blockers.push("Yapılacak bir işlem seçilmedi.");

  const taMeta = (ta ? (chosen?.fields?.[ta] ?? editMeta[ta]) : undefined) as { schema?: { type?: string } } | undefined;

  return {
    transitions: transitions.map((t) => ({ id: t.id, name: t.name, to: t.to.name })),
    steps,
    blockers,
    placements,
    testAssigneeMulti: taMeta?.schema?.type === "array",
    fieldsMapped: { testAssignee: Boolean(ta), storyPointTest: Boolean(sp) },
  };
}

export type StepResult = { kind: ClosePlan["steps"][number]["kind"]; ok: boolean; message: string; uncertain?: boolean };

export const CLOSE_COMMENT_PROPERTY = "qa-assistant";

/**
 * Onaylanan planı sırayla uygular; ilk hatada durur ve o ana kadar yapılanları bildirir.
 * Sonucu belirsiz bir yazma (zaman aşımı) tekrar edilmez, kullanıcıya Jira'yı kontrol etmesi söylenir.
 */
export async function executeClose(
  ctx: Context,
  key: string,
  input: CloseInput,
  analysis: IssueAnalysis,
  run: TestRun | undefined,
  issueUrl: string,
): Promise<{ results: StepResult[]; completed: boolean; plan: ClosePlan }> {
  const plan = await planClose(ctx, key, input);
  if (plan.blockers.length) return { results: [], completed: false, plan };

  const settings = await ctx.settings.read();
  const me = await ctx.myself();
  const ta = settings.fields.testAssignee?.id;
  const sp = settings.fields.storyPointTest?.id;
  const results: StepResult[] = [];
  const now = new Date().toISOString();

  const fieldValue = (kind: "user" | "number") => {
    if (kind === "number") return input.storyPointTest;
    if (!input.testAssignee) return null;
    const user = { accountId: input.testAssignee.accountId };
    return plan.testAssigneeMulti ? [user] : user;
  };
  const transitionFields: Record<string, unknown> = {};
  const editFields: Record<string, unknown> = {};
  if (ta && input.testAssignee) (plan.placements.testAssignee === "transition" ? transitionFields : editFields)[ta] = fieldValue("user");
  if (sp && input.storyPointTest !== null) (plan.placements.storyPointTest === "transition" ? transitionFields : editFields)[sp] = fieldValue("number");

  const run1 = async (kind: StepResult["kind"], okMessage: string, task: () => Promise<unknown>) => {
    try {
      await task();
      results.push({ kind, ok: true, message: okMessage });
      return true;
    } catch (error) {
      const uncertain = error instanceof JiraUnknownOutcomeError || (error instanceof JiraSchemaError && error.committed);
      if (error instanceof JiraSchemaError && error.committed) {
        results.push({ kind, ok: true, message: `${okMessage} (Jira cevabı okunamadı ama işlem uygulandı)` });
        return true;
      }
      results.push({
        kind,
        ok: false,
        uncertain,
        message: uncertain
          ? "Jira zamanında cevap vermedi; işlemin uygulanıp uygulanmadığını Jira'da kontrol edin. Tekrar denemeden önce kontrol edin."
          : error instanceof JiraError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Bilinmeyen hata",
      });
      return false;
    }
  };

  // Deneme kaydı: yarıda kalırsa tekrar denemede yapılmış adımlar atlanır.
  const store = ctx.run(key);
  const stored = (await store.read()) ?? undefined;
  const previous = stored?.closedAt && input.reclose ? undefined : stored?.closeProgress;
  let progress = previous ?? { id: randomBytes(6).toString("hex"), startedAt: now };
  const saveProgress = async (patch: Partial<NonNullable<TestRun["closeProgress"]>>) => {
    progress = { ...progress, ...patch };
    await store.update((r) => ({ ...(r ?? emptyRun(analysis, now)), closeProgress: progress, updatedAt: new Date().toISOString() }));
  };
  await saveProgress({});

  const reportName = input.attachReport ? reportFilename(key, now) : undefined;
  if (input.attachReport) {
    if (progress.attachmentId) {
      results.push({ kind: "attach", ok: true, message: "Rapor önceki denemede eklenmişti; tekrar eklenmedi" });
    } else {
      const html = renderReport({ analysis, run, issueUrl, tester: input.testAssignee?.displayName ?? me.displayName, generatedAt: now });
      const ok = await run1("attach", `${reportName} eklendi`, async () => {
        try {
          const att = await addAttachment(ctx.jira, key, reportName!, html, "text/html");
          await saveProgress({ attachmentId: att?.id ?? "?" });
        } catch (error) {
          // Sonuç belirsizse ek Jira'da var mı bakılır; varsa tekrar yüklenmez.
          if (error instanceof JiraUnknownOutcomeError || (error instanceof JiraSchemaError && error.committed)) {
            const found = (await listAttachments(ctx.jira, key).catch(() => [])).find((a) => a.filename === reportName);
            if (found) return saveProgress({ attachmentId: found.id });
          }
          throw error;
        }
      });
      if (!ok) return { results, completed: false, plan };
    }
  }
  if (input.comment) {
    if (progress.commentId) {
      results.push({ kind: "comment", ok: true, message: "Özet yorum önceki denemede eklenmişti; tekrar eklenmedi" });
    } else {
      const marker = { kind: "test-close", closeId: progress.id };
      const ok = await run1("comment", "Özet yorum eklendi", async () => {
        try {
          const c = await addComment(ctx.jira, key, plainTextToAdf(input.comment), [{ key: CLOSE_COMMENT_PROPERTY, value: marker }]);
          await saveProgress({ commentId: c.id });
        } catch (error) {
          if (error instanceof JiraUnknownOutcomeError || (error instanceof JiraSchemaError && error.committed)) {
            const ids = await findCommentsWithProperty(ctx.jira, key, CLOSE_COMMENT_PROPERTY, (v) => (v as { closeId?: unknown } | null)?.closeId === progress.id).catch(() => []);
            if (ids[0]) return saveProgress({ commentId: ids[0] });
          }
          throw error;
        }
      });
      if (!ok) return { results, completed: false, plan };
    }
  }
  if (Object.keys(editFields).length) {
    if (!(await run1("fields", "Alanlar dolduruldu", () => updateIssueFields(ctx.jira, key, editFields)))) {
      return { results, completed: false, plan };
    }
  } else if (Object.keys(transitionFields).length) {
    results.push({ kind: "fields", ok: true, message: "Alanlar statü geçişiyle birlikte gönderilecek" });
  }
  if (input.transitionId) {
    const t = plan.transitions.find((x) => x.id === input.transitionId);
    if (!(await run1("transition", `Statü: ${t?.to ?? "?"}`, () => transitionIssue(ctx.jira, key, input.transitionId!, transitionFields)))) {
      return { results, completed: false, plan };
    }
  }
  await store.update((r) => {
    const base = r ?? emptyRun(analysis, now);
    const { closeProgress: _done, ...rest } = base;
    return { ...rest, closedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  });
  return { results, completed: true, plan };
}
