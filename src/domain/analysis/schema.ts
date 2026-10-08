import { z } from "zod";
import "@/lib/zod-locale";

/**
 * Madde analizi sözleşmesi. Analizi Claude Code sohbetinde Claude üretir ve
 * `data/analyses/{KEY}.json` dosyasına yazar; uygulama yalnızca bu şemaya uyan dosyaları kabul eder.
 *
 * Değişiklikte `ANALYSIS_SCHEMA_VERSION` artırılır ve `npm run analysis:schema` ile
 * `docs/schemas/issue-analysis.schema.json` yeniden üretilir.
 */
export const ANALYSIS_SCHEMA_VERSION = 1;

export const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]+-[1-9]\d*$/;
export const IssueKeySchema = z.string().regex(ISSUE_KEY_PATTERN, "Jira madde anahtarı olmalı (ör. PROJ-123)");

const text = (max: number) => z.string().trim().min(1, "Boş olamaz").max(max);

/** Jira tarihleri "+0300" biçiminde ofset kullanır; ISO'ya benzeyen ve çözülebilen her değer kabul edilir. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T/, "ISO tarih olmalı (ör. 2026-10-07T10:00:00Z)")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Geçerli bir tarih değil");

export const TEST_CASE_TYPES = [
  "functional",
  "negative",
  "boundary",
  "regression",
  "integration",
  "ui",
  "security",
  "performance",
] as const;

export const PRIORITIES = ["critical", "high", "medium", "low"] as const;

export const TestStepSchema = z
  .object({
    action: text(1000).describe("Testçinin yapacağı tek bir eylem"),
    expected: text(1000).describe("Bu adımın gözlemlenebilir beklenen sonucu"),
  })
  .strict();

export const TestCaseSchema = z
  .object({
    id: z.string().regex(/^TC-\d{2,3}$/, "TC-01 biçiminde olmalı"),
    title: text(200),
    type: z.enum(TEST_CASE_TYPES),
    priority: z.enum(PRIORITIES),
    preconditions: z.array(text(500)).default([]),
    steps: z.array(TestStepSchema).min(1, "En az bir adım gerekli"),
    testData: z
      .array(z.object({ name: text(100), value: text(500) }).strict())
      .default([])
      .describe("Test sırasında kullanılacak somut veriler"),
    sourceRefs: z
      .array(text(500))
      .default([])
      .describe("Bu case'in dayandığı madde içeriği: kısa alıntı ve yeri (ör. 'Açıklama: ...')"),
    assumption: z
      .boolean()
      .describe("Madde içeriğine dayanmıyor, varsayıma dayanıyorsa true"),
  })
  .strict()
  .refine((tc) => tc.assumption || tc.sourceRefs.length > 0, {
    message: "Kaynağı (sourceRefs) olmayan case 'assumption: true' olmalı",
    path: ["sourceRefs"],
  });

export const IssueAnalysisSchema = z
  .object({
    $schema: z.string().optional(),
    schemaVersion: z.literal(ANALYSIS_SCHEMA_VERSION),
    issue: z
      .object({
        key: IssueKeySchema,
        summary: text(500),
        issueType: z.string().optional(),
        status: z.string().optional(),
        /** Analiz edilen sürüm; Jira'daki `updated` ile karşılaştırılıp analizin eskidiği anlaşılır. */
        updated: isoDate.optional(),
      })
      .strict(),
    generatedAt: isoDate,
    generatedBy: z.string().default("claude-code"),
    summary: z
      .object({
        overview: text(2000).describe("Maddenin ne istediğinin 2-4 cümlelik özeti"),
        changes: z.array(text(500)).default([]).describe("Yapılan/yapılacak geliştirmeler"),
        affectedAreas: z.array(text(200)).default([]).describe("Etkilenen ekran, servis, modül"),
        acceptanceCriteria: z.array(text(500)).default([]).describe("Madde içinden çıkarılan kabul kriterleri"),
      })
      .strict(),
    risks: z
      .array(z.object({ description: text(500), severity: z.enum(["high", "medium", "low"]) }).strict())
      .default([]),
    openQuestions: z.array(text(500)).default([]).describe("Developer'a ya da analiste sorulması gerekenler"),
    environmentNotes: z.string().max(1000).optional(),
    testCases: z.array(TestCaseSchema).min(1, "En az bir test case gerekli"),
  })
  .strict()
  .superRefine((analysis, ctx) => {
    const seen = new Set<string>();
    analysis.testCases.forEach((tc, i) => {
      if (seen.has(tc.id)) ctx.addIssue({ code: "custom", message: `Tekrarlanan id: ${tc.id}`, path: ["testCases", i, "id"] });
      seen.add(tc.id);
    });
  });

export type IssueAnalysis = z.infer<typeof IssueAnalysisSchema>;
export type TestCase = z.infer<typeof TestCaseSchema>;

export type AnalysisParseResult = { ok: true; analysis: IssueAnalysis } | { ok: false; errors: string[] };

/** Ham veriyi doğrular; hataları "yol: mesaj" biçiminde, okunur olarak döndürür. */
export function parseAnalysis(raw: unknown, expectedKey?: string): AnalysisParseResult {
  const result = IssueAnalysisSchema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((i) => `${i.path.length ? i.path.join(".") : "(kök)"}: ${i.message}`),
    };
  }
  if (expectedKey && result.data.issue.key !== expectedKey) {
    return { ok: false, errors: [`issue.key: dosya adı ${expectedKey} ama içerik ${result.data.issue.key}`] };
  }
  return { ok: true, analysis: result.data };
}

export const TYPE_LABELS: Record<(typeof TEST_CASE_TYPES)[number], string> = {
  functional: "Fonksiyonel",
  negative: "Negatif",
  boundary: "Sınır değer",
  regression: "Regresyon",
  integration: "Entegrasyon",
  ui: "Arayüz",
  security: "Güvenlik",
  performance: "Performans",
};

export const PRIORITY_LABELS: Record<(typeof PRIORITIES)[number], string> = {
  critical: "Kritik",
  high: "Yüksek",
  medium: "Orta",
  low: "Düşük",
};
