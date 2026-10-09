import { describe, expect, it } from "vitest";
import { ageTone, buildActions, buildQueue, relevantReleases } from "@/domain/dashboard/insights";
import { stageOf, testStatusMatcher } from "@/domain/issues/stage";
import type { ReleaseSummary } from "@/domain/releases/service";

const NOW = new Date(2026, 9, 9, 15, 0).getTime();
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const TEST = { id: "T", name: "Test", category: "indeterminate" as const };
const CODING = { id: "C", name: "Coding", category: "indeterminate" as const };
const NEW = { id: "N", name: "New", category: "new" as const };
const PAUSED = { id: "P", name: "Paused", category: "indeterminate" as const };
const isTest = testStatusMatcher(["T"]);

type Input = Parameters<typeof buildQueue>[0][number];

function item(over: Partial<Input> = {}): Input {
  return {
    key: "OZE-1",
    status: CODING,
    priority: { name: "Medium" },
    updated: daysAgo(0.1),
    statusCategoryChangedAt: daysAgo(30),
    statusSince: daysAgo(0.1),
    devRequest: { eligibility: { eligible: false } },
    ...over,
  };
}

function release(over: Partial<ReleaseSummary>): ReleaseSummary {
  return {
    id: "1",
    name: "v1",
    timing: "scheduled",
    daysToRelease: 10,
    counts: { total: 1, done: 1, inProgress: 0, todo: 0, inTest: 0, staleInTest: 0, toBeDeployed: 0, completed: 1, other: 0 },
    readyToClose: false,
    ...over,
  };
}

describe("aşama", () => {
  it("testte, sırada, beklemede ve geliştirmede ayrımı", () => {
    expect(stageOf(TEST, isTest)).toBe("test");
    expect(stageOf(NEW, isTest)).toBe("new");
    expect(stageOf(PAUSED, isTest)).toBe("paused");
    expect(stageOf(CODING, isTest)).toBe("progress");
    expect(stageOf({ id: "D", name: "Completed", category: "done" }, isTest)).toBe("done");
  });

  it("testte statüsü seçilmemişse ada göre tanır", () => {
    const byName = testStatusMatcher([]);
    expect(byName({ id: "9", name: "Test" })).toBe(true);
    expect(byName({ id: "9", name: "In Test" })).toBe(true);
    expect(byName({ id: "9", name: "Test Review" })).toBe(false);
  });
});

describe("buildQueue", () => {
  it("bekleme süresini statüye giriş anından hesaplar, en uzun bekleyen başta", () => {
    const q = buildQueue(
      [item({ key: "A", statusSince: daysAgo(2) }), item({ key: "B", statusSince: daysAgo(9) }), item({ key: "C", statusSince: undefined, statusCategoryChangedAt: daysAgo(4) })],
      isTest,
      NOW,
    );
    expect(q.map((i) => [i.key, i.days])).toEqual([
      ["B", 9],
      ["C", 4],
      ["A", 2],
    ]);
  });

  it("yaş rengi testte eşik ve iki katına göre değişir", () => {
    expect(ageTone("test", 4, 5)).toBe("neutral");
    expect(ageTone("test", 5, 5)).toBe("warning");
    expect(ageTone("test", 10, 5)).toBe("danger");
    expect(ageTone("paused", 29, 5)).toBe("neutral");
    expect(ageTone("paused", 30, 5)).toBe("warning");
  });
});

describe("buildActions", () => {
  it("önerileri önem sırasıyla ve yalnızca sayısı olanları döner", () => {
    const queue = buildQueue(
      [
        item({ key: "A", status: TEST, priority: { name: "High" }, statusSince: daysAgo(1) }),
        item({ key: "B", status: TEST, statusSince: daysAgo(6) }),
        item({ key: "C", status: PAUSED, statusSince: daysAgo(45) }),
        // Geliştirmedeki yüksek öncelikli madde QA'nın işi değil; öneri sayılmaz.
        item({ key: "D", status: CODING, priority: { name: "Highest" } }),
      ],
      isTest,
      NOW,
    );
    const actions = buildActions({
      queue,
      releases: [
        release({ id: "r1", timing: "overdue", daysToRelease: -3 }),
        release({ id: "r2", timing: "overdue", daysToRelease: -400 }),
        release({ id: "r3", readyToClose: true }),
        release({ id: "r4", timing: "soon", daysToRelease: 2, counts: { ...release({}).counts, inTest: 3 } }),
      ],
      staleTestDays: 5,
      missingEffort: 2,
    });
    expect(actions.map((a) => [a.id, a.count])).toEqual([
      ["overdue", 1],
      ["high-priority", 1],
      ["release-risk", 3],
      ["stale-test", 1],
      ["ready", 1],
      ["missing-effort", 2],
      ["old-paused", 1],
    ]);
    expect(actions.find((a) => a.id === "stale-test")?.target).toEqual({ tab: "test" });
    expect(actions.find((a) => a.id === "old-paused")?.target).toEqual({ tab: "paused" });
  });

  it("gönderilmiş bilgi talebini tekrar önermez", () => {
    const queue = buildQueue(
      [item({ devRequest: { eligibility: { eligible: true }, ledger: { state: "sent" } } }), item({ key: "X", devRequest: { eligibility: { eligible: true } } })],
      isTest,
      NOW,
    );
    expect(buildActions({ queue, staleTestDays: 5 }).find((a) => a.id === "dev-request")?.count).toBe(1);
  });
});

describe("relevantReleases", () => {
  it("yakın gecikenleri ve yaklaşanları gösterir, eski gecikmişleri sayar", () => {
    const { shown, hiddenOld } = relevantReleases([
      release({ id: "late", timing: "overdue", daysToRelease: -2 }),
      release({ id: "far", timing: "scheduled", daysToRelease: 20 }),
      release({ id: "soon", timing: "soon", daysToRelease: 2 }),
      release({ id: "old", timing: "overdue", daysToRelease: -300 }),
    ]);
    expect(shown.map((r) => r.id)).toEqual(["late", "soon", "far"]);
    expect(hiddenOld).toBe(1);
  });
});
