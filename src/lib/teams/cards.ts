import type { AdaptiveCard } from "./webhook";

/**
 * Adaptive Card şablonları. Kart metinleri sınırlı markdown destekler; Jira'dan gelen metinler
 * işaretleme karakterlerinden arındırılır ki sahte link ya da biçim enjekte edilemesin.
 */
export function plain(value: string, max = 200): string {
  const cleaned = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[*_~`#>[\]()|\\<]/g, "")
    // Teams ham adresleri kendiliğinden linke çevirir; görünmez bir karakterle bu engellenir
    // (Jira metnindeki bir oltalama adresi Teams'te tıklanabilir olmasın).
    .replace(/:\/\//g, ":⁠//")
    .replace(/\bwww\./gi, (m) => `${m.slice(0, 3)}⁠.`)
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

const base = (body: unknown[], actions?: unknown[]): AdaptiveCard => ({
  $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
  type: "AdaptiveCard",
  version: "1.4",
  body,
  ...(actions?.length ? { actions } : {}),
  msteams: { width: "Full" },
});

const header = (title: string, subtitle: string, style: "good" | "attention" | "accent") => ({
  type: "Container",
  style: style === "good" ? "good" : style === "attention" ? "attention" : "accent",
  bleed: true,
  items: [
    { type: "TextBlock", text: title, weight: "Bolder", size: "Large", wrap: true },
    { type: "TextBlock", text: subtitle, isSubtle: true, spacing: "None", wrap: true },
  ],
});

const facts = (items: [string, string][]) => ({
  type: "FactSet",
  facts: items.map(([title, value]) => ({ title, value: plain(value, 120) })),
});

const openUrl = (title: string, url: string) => ({ type: "Action.OpenUrl", title, url });

export function testCard(sender: string): AdaptiveCard {
  return base([
    header("QA Asistanı bağlantı testi", "Bu hedef bildirimler için hazır.", "accent"),
    { type: "TextBlock", text: `Gönderen: ${plain(sender)}`, isSubtle: true, wrap: true },
  ]);
}

export type ReleaseCardInput = {
  projectName: string;
  versionName: string;
  releaseDate: string;
  closedBy: string;
  transitioned: { key: string; summary: string }[];
  untouched: number;
  jiraBaseUrl: string;
  versionUrl: string;
};

export function releaseClosedCard(input: ReleaseCardInput): AdaptiveCard {
  const shown = input.transitioned.slice(0, 25);
  const more = input.transitioned.length - shown.length;
  return base(
    [
      header(`🚀 ${plain(input.versionName, 80)} canlıya alındı`, plain(input.projectName, 80), "good"),
      facts([
        ["Release", input.versionName],
        ["Tarih", input.releaseDate],
        ["Completed yapılan", String(input.transitioned.length)],
        ["Zaten Completed", String(input.untouched)],
        ["Kapatan", input.closedBy],
      ]),
      ...(shown.length
        ? [
            { type: "TextBlock", text: "Completed yapılan maddeler", weight: "Bolder", spacing: "Medium" },
            ...shown.map((i) => ({
              type: "TextBlock",
              text: `[${plain(i.key, 30)}](${input.jiraBaseUrl}/browse/${encodeURIComponent(i.key)}) — ${plain(i.summary, 120)}`,
              wrap: true,
              spacing: "Small",
            })),
            ...(more > 0 ? [{ type: "TextBlock", text: `… ve ${more} madde daha`, isSubtle: true }] : []),
          ]
        : []),
    ],
    [openUrl("Release'i Jira'da aç", input.versionUrl)],
  );
}

export type TestClosedCardInput = {
  issueKey: string;
  summary: string;
  verdict: string;
  counts: { passed: number; failed: number; blocked: number; skipped: number; total: number };
  tester: string;
  issueUrl: string;
};

export function testClosedCard(input: TestClosedCardInput): AdaptiveCard {
  const ok = input.counts.failed === 0 && input.counts.blocked === 0;
  return base(
    [
      header(`${ok ? "✅" : "⚠️"} ${plain(input.issueKey, 30)} testi tamamlandı — ${plain(input.verdict, 30)}`, plain(input.summary, 160), ok ? "good" : "attention"),
      facts([
        ["Toplam", String(input.counts.total)],
        ["Başarılı", String(input.counts.passed)],
        ["Başarısız", String(input.counts.failed)],
        ["Bloke", String(input.counts.blocked)],
        ["Atlandı", String(input.counts.skipped)],
        ["Testçi", input.tester],
      ]),
    ],
    [openUrl("Maddeyi Jira'da aç", input.issueUrl)],
  );
}

export type WeeklyCardInput = {
  title: string;
  person: string;
  totals: { closed: number; effort: number; missingEffort: number; bugs: number; returned: number; paused: number };
  closed: { key: string; summary: string; effort?: number }[];
  bugs: { key: string; summary: string }[];
  note: string;
  jiraBaseUrl: string;
};

export function weeklyReportCard(input: WeeklyCardInput): AdaptiveCard {
  const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
  const t = input.totals;
  const list = (title: string, items: { key: string; summary: string; effort?: number }[], effort: boolean) => {
    const shown = items.slice(0, 20);
    if (!shown.length) return [];
    return [
      { type: "TextBlock", text: `${title} (${items.length})`, weight: "Bolder", spacing: "Medium" },
      ...shown.map((i) => ({
        type: "TextBlock",
        text: `[${plain(i.key, 30)}](${input.jiraBaseUrl}/browse/${encodeURIComponent(i.key)}) — ${plain(i.summary, 110)}${effort && i.effort !== undefined ? ` · ${nf.format(i.effort)} SP` : ""}`,
        wrap: true,
        spacing: "Small",
      })),
      ...(items.length > shown.length ? [{ type: "TextBlock", text: `… ve ${items.length - shown.length} madde daha`, isSubtle: true }] : []),
    ];
  };
  // Not satırları ayrı bloklar olur; madde işaretli notlar tek paragrafa dönüşmesin.
  const noteLines = input.note
    .slice(0, 1500)
    .split(/\r?\n/)
    .map((l) => plain(l, 300))
    .filter(Boolean)
    .slice(0, 30);
  return base([
    header(`📊 Haftalık rapor · ${plain(input.title, 80)}`, plain(input.person, 80), "accent"),
    facts([
      ["Kapattığım", String(t.closed)],
      ["Efor (StoryPointTest)", `${nf.format(t.effort)} SP${t.missingEffort ? ` · ${t.missingEffort} maddede efor yok` : ""}`],
      ["Bulduğum bug", String(t.bugs)],
      ["Geri gönderdiğim", String(t.returned)],
      ["Beklemeye aldığım", String(t.paused)],
    ]),
    ...list("Kapattıklarım", input.closed, true),
    ...list("Bulduğum buglar", input.bugs, false),
    ...(noteLines.length
      ? [
          { type: "TextBlock", text: "Notlar", weight: "Bolder", spacing: "Medium" },
          ...noteLines.map((text) => ({ type: "TextBlock", text, wrap: true, spacing: "None" })),
        ]
      : []),
  ]);
}
