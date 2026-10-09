import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testStatusMatcher } from "@/domain/issues/stage";
import { buildWeekReport, classifyTransition, type ActivityData } from "@/domain/weekly/activity";
import { weeklyMarkdown } from "@/domain/weekly/markdown";
import { getWeeklyHistory, getWeeklyReport, saveWeek, sendWeekToTeams } from "@/domain/weekly/service";
import { isWeekId, jqlDate, recentWeeks, shiftWeek, weekIdOf, weekLabel, weekRange, weekStart } from "@/domain/weekly/week";
import type { Context } from "@/lib/server/context";
import { TeamsTargetError } from "@/lib/teams/send";
import { setupFakeContext } from "../helpers/fake-jira";
import { JIRA } from "../helpers/jira";
import { server } from "../helpers/msw";

describe("ISO hafta", () => {
  it("haftayı Pazartesi başlangıçlı ISO kuralıyla bulur", () => {
    expect(weekIdOf(new Date(2026, 9, 9))).toBe("2026-W41");
    expect(weekIdOf(new Date(2026, 9, 5, 0, 0))).toBe("2026-W41");
    expect(weekIdOf(new Date(2026, 9, 4, 23, 59))).toBe("2026-W40");
    // Yıl sınırı: 1 Ocak 2026 Perşembe → 2026-W01; 29 Aralık 2025 Pazartesi de 2026-W01.
    expect(weekIdOf(new Date(2025, 11, 29))).toBe("2026-W01");
    expect(weekIdOf(new Date(2027, 0, 1))).toBe("2026-W53");
  });

  it("aralık, kaydırma ve doğrulama", () => {
    expect(weekStart("2026-W41")).toEqual(new Date(2026, 9, 5));
    expect(weekRange("2026-W41").end).toEqual(new Date(2026, 9, 12));
    expect(shiftWeek("2026-W01", -1)).toBe("2025-W52");
    expect(shiftWeek("2026-W53", 1)).toBe("2027-W01");
    expect(recentWeeks("2026-W02", 3)).toEqual(["2025-W52", "2026-W01", "2026-W02"]);
    expect(isWeekId("2026-W53")).toBe(true);
    expect(isWeekId("2025-W53")).toBe(false);
    expect(isWeekId("2026-W00")).toBe(false);
    expect(isWeekId("2026-41")).toBe(false);
  });

  it("okunur etiket ve JQL tarihi", () => {
    expect(weekLabel("2026-W41")).toBe("5–11 Ekim 2026");
    expect(weekLabel("2026-W40")).toBe("28 Eylül – 4 Ekim 2026");
    expect(jqlDate(new Date(2026, 9, 5, 7, 3))).toBe("2026/10/05 07:03");
  });
});

// ── Saf rapor hesabı ─────────────────────────────────────────────────────────

const STATUSES = new Map([
  ["N", { name: "New", category: "new" }],
  ["CO", { name: "Coding", category: "indeterminate" }],
  ["T", { name: "Test", category: "indeterminate" }],
  ["P", { name: "Paused", category: "indeterminate" }],
  ["TBD", { name: "To be Deployed", category: "done" }],
  ["D", { name: "Completed", category: "done" }],
  ["X", { name: "Canceled", category: "done" }],
  ["IP", { name: "In Progress", category: "indeterminate" }],
  ["TP", { name: "Test Paused", category: "indeterminate" }],
]);
const base = { statuses: STATUSES, isTest: testStatusMatcher(["T", "TP"]) };

describe("classifyTransition", () => {
  it.each([
    ["T", "D", "closed"],
    ["T", "TBD", "closed"],
    ["TBD", "D", null],
    ["T", "X", null],
    ["T", "P", "paused"],
    ["P", "P", null],
    ["T", "CO", "returned"],
    ["T", "N", "returned"],
    ["CO", "T", "started"],
    ["N", "IP", "started"],
    ["P", "N", null],
    // "Testte" eşlemesi ada göre beklemede tanımadan önce gelir (panodaki stageOf ile aynı sıra).
    ["CO", "TP", "started"],
    ["TP", "CO", "returned"],
    ["N", "P", "paused"],
  ] as const)("%s → %s = %s", (from, to, kind) => {
    expect(classifyTransition(from, to, base)).toBe(kind);
  });
});

const at = (d: number, h = 10) => new Date(2026, 9, d, h).getTime();

function activity(over: Partial<ActivityData> = {}): ActivityData {
  const issue = (id: string, effort?: number) => ({ id, key: `OZE-${id}`, summary: `Madde ${id}`, status: { name: "Completed", category: "done" }, effort });
  return {
    ...base,
    issues: new Map([
      ["1", issue("1", 3)],
      ["2", issue("2")],
      ["3", issue("3", 2.5)],
      ["4", issue("4")],
    ]),
    statusEvents: [
      { issueId: "1", at: at(5, 9), from: "CO", to: "T", byMe: false },
      { issueId: "1", at: at(6), from: "T", to: "D", byMe: true },
      { issueId: "2", at: at(7), from: "T", to: "P", byMe: true },
      { issueId: "2", at: at(8), from: "P", to: "T", byMe: true },
      { issueId: "2", at: at(9), from: "T", to: "P", byMe: true },
      { issueId: "3", at: at(9, 11), from: "T", to: "TBD", byMe: true },
      { issueId: "3", at: at(10), from: "TBD", to: "D", byMe: true },
      // Önceki hafta
      { issueId: "4", at: at(2), from: "T", to: "CO", byMe: true },
    ],
    assignEvents: [{ issueId: "4", at: at(6) }],
    bugs: [{ id: "9", key: "OZE-9", summary: "Hata", status: { name: "New", category: "new" }, created: new Date(at(7)).toISOString() }],
    ...over,
  };
}

describe("buildWeekReport", () => {
  it("kapatılan, beklemeye alınan, gelen ve bug sayılarını haftaya göre çıkarır", () => {
    const r = buildWeekReport("2026-W41", activity());
    expect(r.totals).toEqual({ closed: 2, effort: 5.5, missingEffort: 0, returned: 0, paused: 1, started: 1, bugs: 1, received: 1, moves: 6 });
    // Aynı madde haftada iki kez beklemeye alındı: bir kez listelenir, son geçişle.
    expect(r.lists.paused.map((i) => [i.key, i.at])).toEqual([["OZE-2", new Date(at(9)).toISOString()]]);
    expect(r.lists.closed.map((i) => [i.key, i.transition])).toEqual([
      ["OZE-3", "Test → To be Deployed"],
      ["OZE-1", "Test → Completed"],
    ]);
    expect(r.days.map((d) => d.moves)).toEqual([0, 1, 1, 1, 2, 1, 0]);
    expect(r.days[1]!.closed).toBe(1);
  });

  it("efor girilmemiş kapanışları ayrıca sayar; önceki hafta ayrı hesaplanır", () => {
    const data = activity();
    data.issues.get("1")!.effort = undefined;
    expect(buildWeekReport("2026-W41", data).totals).toMatchObject({ closed: 2, effort: 2.5, missingEffort: 1 });
    expect(buildWeekReport("2026-W40", data).totals).toMatchObject({ returned: 1, closed: 0, received: 0, moves: 1 });
  });
});

describe("weeklyMarkdown", () => {
  it("madde linklerini ve notu içerir, işaretleme karakterlerini kaçırır", () => {
    const data = activity();
    data.issues.get("1")!.summary = "Fatura [ekranı](http://kotu.example) *kalın*";
    data.issues.get("3")!.summary = "Bkz. https://kotu.example ve www.kotu.example";
    const md = weeklyMarkdown(buildWeekReport("2026-W41", data), { jiraBaseUrl: JIRA, note: "Ortam 2 gün kapalıydı", person: "Ali" });
    expect(md).toContain("Hafta 41 (5–11 Ekim 2026) · Ali");
    expect(md).toContain(`[OZE-1](${JIRA}/browse/OZE-1) Fatura \\[ekranı\\]\\(http:⁠//kotu.example\\) \\*kalın\\*`);
    expect(md).toContain("Bkz. https:⁠//kotu.example ve www⁠.kotu.example");
    expect(md).toContain("**5,5 SP**");
    expect(md).toContain("### Notlar\nOrtam 2 gün kapalıydı");
    expect(md).not.toContain("Başladıklarım (");
  });
});

// ── Jira'dan okuma (sahte Jira) ──────────────────────────────────────────────

let ctx: Context;
let cleanup: () => Promise<void>;
const NOW = new Date(2026, 9, 9, 15);
const jqls: string[] = [];

const issueJson = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  key: `OZE-${id}`,
  fields: { summary: `Madde ${id}`, status: { id: "11", name: "Completed", statusCategory: { key: "done" } }, issuetype: { name: "Story" }, fixVersions: [{ name: "v1" }], ...extra },
});

beforeEach(async () => {
  ({ ctx, cleanup } = await setupFakeContext());
  await ctx.settings.update((s) => ({ ...s, fields: { ...s.fields, storyPointTest: { id: "customfield_sp", name: "StoryPointTest" } } }));
  jqls.length = 0;
  server.use(
    http.post(`${JIRA}/rest/api/3/search/jql`, async ({ request }) => {
      const { jql } = (await request.json()) as { jql: string };
      jqls.push(jql);
      if (jql.startsWith("status changed BY currentUser()")) return HttpResponse.json({ issues: [issueJson("1", { customfield_sp: 3 }), issueJson("2")], isLast: true });
      if (jql.startsWith("assignee changed TO currentUser()")) return HttpResponse.json({ issues: [issueJson("3")], isLast: true });
      if (jql.includes("issuetype = Bug")) return HttpResponse.json({ issues: [issueJson("5", { created: new Date(at(8)).toISOString() })], isLast: true });
      return undefined;
    }),
    http.get(`${JIRA}/rest/api/3/status`, () =>
      HttpResponse.json([
        { id: "3", name: "In Test", statusCategory: { key: "indeterminate" } },
        { id: "11", name: "Completed", statusCategory: { key: "done" } },
        { id: "20", name: "Coding", statusCategory: { key: "indeterminate" } },
        { id: "21", name: "Paused", statusCategory: { key: "indeterminate" } },
      ]),
    ),
    http.post(`${JIRA}/rest/api/3/changelog/bulkfetch`, () =>
      HttpResponse.json({
        issueChangeLogs: [
          {
            issueId: "1",
            changeHistories: [
              { created: at(5, 9), author: { accountId: "dev-1" }, items: [{ fieldId: "status", from: "20", to: "3" }] },
              { created: at(6), author: { accountId: "me-1" }, items: [{ fieldId: "status", from: "3", to: "11" }] },
            ],
          },
          { issueId: "2", changeHistories: [{ created: at(1), author: { accountId: "me-1" }, items: [{ fieldId: "status", from: "3", to: "21" }] }] },
          {
            issueId: "3",
            changeHistories: [
              { created: at(7), author: { accountId: "lead" }, items: [{ fieldId: "assignee", from: "dev-1", to: "me-1" }] },
              { created: at(8), author: { accountId: "lead" }, items: [{ fieldId: "assignee", from: "me-1", to: "someone" }] },
            ],
          },
        ],
      }),
    ),
  );
});
afterEach(async () => {
  await cleanup();
});

describe("haftalık rapor servisi", () => {
  it("haftanın raporunu ve önceki haftanın sayılarını tek okumayla üretir", async () => {
    const r = await getWeeklyReport(ctx, "2026-W41", NOW);
    expect(r.currentWeek).toBe("2026-W41");
    expect(r.report.totals).toMatchObject({ closed: 1, effort: 3, received: 1, bugs: 1, moves: 1 });
    expect(r.report.lists.closed[0]).toMatchObject({ key: "OZE-1", release: "v1", effort: 3, transition: "In Test → Completed" });
    expect(r.previous).toMatchObject({ paused: 1, closed: 0 });
    expect(jqls.find((j) => j.startsWith("status changed"))).toBe('status changed BY currentUser() DURING ("2026/09/27 00:00", "2026/10/13 00:00")');
  });

  it("projede Bug tipi yoksa rapor bug listesi olmadan çalışır", async () => {
    server.use(
      http.post(`${JIRA}/rest/api/3/search/jql`, async ({ request }) => {
        const { jql } = (await request.clone().json()) as { jql: string };
        return jql.includes("issuetype = Bug") ? HttpResponse.json({ errorMessages: ["Bug yok"] }, { status: 400 }) : undefined;
      }),
    );
    expect((await getWeeklyReport(ctx, "2026-W41", NOW)).report.totals.bugs).toBe(0);
  });

  it("Jira'ya ulaşılamazsa not yine kaydedilir, önceki sayılar korunur", async () => {
    await saveWeek(ctx, "2026-W41", "İlk", NOW);
    server.use(http.post(`${JIRA}/rest/api/3/search/jql`, () => HttpResponse.json({ errorMessages: ["bakımda"] }, { status: 503 })));
    const saved = await saveWeek(ctx, "2026-W41", "Çevrimdışı not", NOW);
    expect(saved).toMatchObject({ note: "Çevrimdışı not", totals: { closed: 1 } });
    await expect(saveWeek(ctx, "2026-W40", "Sayısız", NOW)).resolves.toMatchObject({ note: "Sayısız", totals: undefined });
  });

  it("notu ve sayıları kaydeder; geçmişte kayıt görünür", async () => {
    const saved = await saveWeek(ctx, "2026-W41", "Not", NOW);
    expect(saved).toMatchObject({ note: "Not", totals: { closed: 1 } });
    const history = await getWeeklyHistory(ctx, NOW);
    expect(history.weeks).toHaveLength(12);
    expect(history.weeks.at(-1)).toMatchObject({ week: "2026-W41", totals: { closed: 1 }, saved: { savedAt: NOW.toISOString() } });
    expect(history.weeks.at(-2)!.saved).toBeUndefined();
  });

  it("Teams hedefi yoksa Jira'dan okumadan reddeder", async () => {
    jqls.length = 0;
    await expect(sendWeekToTeams(ctx, "2026-W41", "", { targetId: "yok-hedef", contactIds: [] }, NOW)).rejects.toBeInstanceOf(TeamsTargetError);
    expect(jqls).toEqual([]);
  });

  it("raporu Teams'e gönderir ve gönderimi kaydeder", async () => {
    let card: unknown;
    server.use(
      http.post("https://prod.westeurope.logic.azure.com/workflows/abc", async ({ request }) => {
        card = await request.json();
        return new HttpResponse(null, { status: 202 });
      }),
    );
    await ctx.settings.update((s) => ({
      ...s,
      teams: { ...s.teams, targets: [{ id: "hedef-1", name: "QA", kind: "channel", url: "https://prod.westeurope.logic.azure.com/workflows/abc" }] },
    }));
    const saved = await sendWeekToTeams(ctx, "2026-W41", "Haftalık not\n- ortam kapalıydı", { targetId: "hedef-1", contactIds: [] }, NOW);
    expect(saved).toMatchObject({ note: "Haftalık not\n- ortam kapalıydı", sentAt: NOW.toISOString(), sentTo: "QA · Kanal" });
    const text = JSON.stringify(card);
    expect(text).toContain(`[OZE-1](${JIRA}/browse/OZE-1)`);
    // Not satırları ayrı bloklar olarak gider.
    expect(text).toContain('"text":"Haftalık not"');
    expect(text).toContain('"text":"- ortam kapalıydı"');
  });
});
