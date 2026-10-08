import { describe, expect, it } from "vitest";
import { parseAnalysis } from "@/domain/analysis/schema";

export function sampleAnalysis(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    issue: { key: "PROJ-12", summary: "Fatura listesine filtre eklenmesi", updated: "2026-10-07T09:00:00.000+0300" },
    generatedAt: "2026-10-07T10:00:00Z",
    summary: { overview: "Fatura listesine tarih filtresi eklenir." },
    testCases: [
      {
        id: "TC-01",
        title: "Tarih aralığıyla filtreleme",
        type: "functional",
        priority: "high",
        steps: [{ action: "Başlangıç ve bitiş tarihi seç", expected: "Yalnızca aralıktaki faturalar listelenir" }],
        sourceRefs: ["Açıklama: 'tarih aralığına göre filtrelenebilmeli'"],
        assumption: false,
      },
    ],
    ...over,
  };
}

describe("parseAnalysis", () => {
  it("geçerli analizi varsayılanlarla kabul eder", () => {
    const result = parseAnalysis(sampleAnalysis(), "PROJ-12");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.analysis.generatedBy).toBe("claude-code");
    expect(result.analysis.testCases[0]?.preconditions).toEqual([]);
    expect(result.analysis.risks).toEqual([]);
  });

  it("dosya adı ile içerikteki anahtar farklıysa reddeder", () => {
    const result = parseAnalysis(sampleAnalysis(), "PROJ-13");
    expect(result.ok).toBe(false);
  });

  it("kaynağı olmayan ve varsayım işaretlenmemiş case'i reddeder", () => {
    const tc = { ...sampleAnalysis().testCases[0], sourceRefs: [], assumption: false };
    const result = parseAnalysis(sampleAnalysis({ testCases: [tc] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join()).toContain("testCases.0.sourceRefs");
  });

  it("tekrarlanan case id'lerini reddeder", () => {
    const tc = sampleAnalysis().testCases[0];
    const result = parseAnalysis(sampleAnalysis({ testCases: [tc, tc] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join()).toContain("Tekrarlanan id: TC-01");
  });

  it("bilinmeyen alanları ve yanlış sürümü reddeder", () => {
    expect(parseAnalysis(sampleAnalysis({ fazladan: 1 })).ok).toBe(false);
    expect(parseAnalysis(sampleAnalysis({ schemaVersion: 2 })).ok).toBe(false);
  });

  it("geçersiz madde anahtarını reddeder (dosya yolu güvenliği)", () => {
    const bad = sampleAnalysis({ issue: { key: "../../etc", summary: "x" } });
    expect(parseAnalysis(bad).ok).toBe(false);
  });

  it("boş adım ya da adımsız case'i reddeder", () => {
    const tc = { ...sampleAnalysis().testCases[0], steps: [] };
    expect(parseAnalysis(sampleAnalysis({ testCases: [tc] })).ok).toBe(false);
  });
});
