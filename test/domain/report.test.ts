import { describe, expect, it } from "vitest";
import { parseAnalysis } from "@/domain/analysis/schema";
import { defaultCloseComment } from "@/domain/issue-close/service";
import { renderReport } from "@/domain/report/html";
import { summarizeRun, type TestRun } from "@/domain/testrun/schema";
import { sampleAnalysis } from "./analysis/schema.test";

const analysis = (() => {
  const r = parseAnalysis(
    sampleAnalysis({
      issue: { key: "PROJ-12", summary: '<img src=x onerror="alert(1)">' },
      testCases: [
        {
          id: "TC-01",
          title: "<script>alert('x')</script>",
          type: "functional",
          priority: "high",
          steps: [{ action: "a & b", expected: '"tırnak"' }],
          assumption: true,
        },
        { id: "TC-02", title: "İkinci", type: "negative", priority: "low", steps: [{ action: "x", expected: "y" }], assumption: true },
      ],
    }),
  );
  if (!r.ok) throw new Error(r.errors.join());
  return r.analysis;
})();

const run: TestRun = {
  issueKey: "PROJ-12",
  analysisGeneratedAt: analysis.generatedAt,
  environment: "TEST2",
  results: {
    "TC-01": { status: "passed", note: "", updatedAt: "2026-10-07T10:00:00Z" },
    "TC-02": { status: "failed", note: "500 hatası <b>", updatedAt: "2026-10-07T10:00:00Z" },
  },
  startedAt: "2026-10-07T09:00:00Z",
  updatedAt: "2026-10-07T10:00:00Z",
};

describe("HTML rapor", () => {
  const html = renderReport({ analysis, run, issueUrl: "javascript:alert(1)", tester: "QA <Kişi>", generatedAt: "2026-10-07T11:00:00Z" });

  it("tüm içeriği kaçışlar (XSS yok)", () => {
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("QA &lt;Kişi&gt;");
  });

  it("javascript: bağlantısını eklemez ve script'i CSP ile yasaklar", () => {
    expect(html).not.toContain("javascript:");
    expect(html).toContain("default-src 'none'");
  });

  it("sonucu ve sorunlu case'leri gösterir", () => {
    expect(html).toContain("Sonuç: Başarısız");
    expect(html).toContain("Dikkat gerektiren");
    expect(html).toContain("TEST2");
  });
});

describe("Test özeti", () => {
  it("sonucu doğru hesaplar", () => {
    expect(summarizeRun(analysis, run)).toMatchObject({ total: 2, done: 2, progress: 100, verdict: "failed" });
    expect(summarizeRun(analysis, undefined).verdict).toBe("not-started");
  });

  it("varsayılan kapanış yorumu sayıları ve sorunlu case'leri içerir", () => {
    const text = defaultCloseComment(analysis, run, "rapor.html");
    expect(text).toContain("Sonuç: Başarısız");
    expect(text).toContain("1 başarılı, 1 başarısız");
    expect(text).toContain("TC-02");
    expect(text).toContain("rapor.html");
  });
});
