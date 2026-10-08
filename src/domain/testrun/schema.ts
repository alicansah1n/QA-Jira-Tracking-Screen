import { z } from "zod";
import "@/lib/zod-locale";
import type { IssueAnalysis } from "@/domain/analysis/schema";

export const CASE_STATUSES = ["pending", "passed", "failed", "blocked", "skipped"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  pending: "Bekliyor",
  passed: "Başarılı",
  failed: "Başarısız",
  blocked: "Bloke",
  skipped: "Atlandı",
};

export const CaseResultSchema = z.object({
  status: z.enum(CASE_STATUSES),
  note: z.string().max(2000).default(""),
  updatedAt: z.string(),
});
export type CaseResult = z.infer<typeof CaseResultSchema>;

export const TestRunSchema = z.object({
  issueKey: z.string(),
  /** Hangi analiz sürümüne göre çalıştırıldığı; analiz yenilenirse kullanıcı uyarılır. */
  analysisGeneratedAt: z.string(),
  environment: z.string().max(200).default(""),
  results: z.record(z.string(), CaseResultSchema).default({}),
  startedAt: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().optional(),
  /**
   * Yarıda kalmış kapatma denemesi: tamamlanan adımlar burada tutulur ki tekrar denemede
   * rapor eki ve yorum ikinci kez gönderilmesin.
   */
  closeProgress: z
    .object({ id: z.string(), startedAt: z.string(), attachmentId: z.string().optional(), commentId: z.string().optional() })
    .optional(),
});
export type TestRun = z.infer<typeof TestRunSchema>;

export const TEST_RUN_VERSION = 1;

export const RunUpdateSchema = z.object({
  environment: z.string().max(200).optional(),
  results: z
    .record(z.string().regex(/^TC-\d{2,3}$/), z.object({ status: z.enum(CASE_STATUSES), note: z.string().max(2000).default("") }))
    .optional(),
});
export type RunUpdate = z.infer<typeof RunUpdateSchema>;

export type Verdict = "passed" | "failed" | "blocked" | "in-progress" | "not-started";

export const VERDICT_LABELS: Record<Verdict, string> = {
  passed: "Başarılı",
  failed: "Başarısız",
  blocked: "Bloke",
  "in-progress": "Devam ediyor",
  "not-started": "Başlanmadı",
};

export type RunSummary = {
  total: number;
  counts: Record<CaseStatus, number>;
  done: number;
  progress: number;
  verdict: Verdict;
};

export function summarizeRun(analysis: IssueAnalysis, run: TestRun | undefined): RunSummary {
  const counts: Record<CaseStatus, number> = { pending: 0, passed: 0, failed: 0, blocked: 0, skipped: 0 };
  for (const tc of analysis.testCases) counts[run?.results[tc.id]?.status ?? "pending"]++;
  const total = analysis.testCases.length;
  const done = total - counts.pending;
  const verdict: Verdict =
    counts.failed > 0
      ? "failed"
      : counts.blocked > 0
        ? "blocked"
        : done === 0
          ? "not-started"
          : counts.pending > 0
            ? "in-progress"
            : "passed";
  return { total, counts, done, progress: total ? Math.round((done / total) * 100) : 0, verdict };
}

export function emptyRun(analysis: IssueAnalysis, now: string): TestRun {
  return {
    issueKey: analysis.issue.key,
    analysisGeneratedAt: analysis.generatedAt,
    environment: analysis.environmentNotes?.slice(0, 200) ?? "",
    results: {},
    startedAt: now,
    updatedAt: now,
  };
}
