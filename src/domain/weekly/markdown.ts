import type { ListKey, ReportItem, WeekReport } from "./activity";
import { weekLabel, weekNumber } from "./week";

export const LIST_LABELS: Record<ListKey, string> = {
  closed: "Kapattıklarım",
  bugs: "Bulduğum buglar",
  returned: "Geri gönderdiklerim",
  paused: "Beklemeye aldıklarım",
  started: "Başladıklarım",
  received: "Bana gelenler",
};

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });

/**
 * Markdown'da link/biçim bozan karakterler kaçırılır. Ham adresler (Jira özetindeki bir oltalama linki)
 * yapıştırıldığı yerde kendiliğinden tıklanabilir olmasın diye görünmez bir karakterle bölünür.
 */
const clean = (s: string) =>
  s
    .replace(/[\r\n\t]+/g, " ")
    .replace(/([[\]()*_`|\\<>#!~])/g, "\\$1")
    .replace(/:\/\//g, ":⁠//")
    .replace(/\bwww\./gi, (m) => `${m.slice(0, 3)}⁠.`)
    .trim();

function line(i: ReportItem, jiraBaseUrl: string | undefined, withEffort: boolean): string {
  const key = jiraBaseUrl ? `[${clean(i.key)}](${jiraBaseUrl}/browse/${encodeURIComponent(i.key)})` : i.key;
  const extra = [i.release && `release: ${clean(i.release)}`, withEffort && (i.effort !== undefined ? `${nf.format(i.effort)} SP` : "efor yok")].filter(Boolean);
  return `- ${key} ${clean(i.summary)}${extra.length ? ` _(${extra.join(" · ")})_` : ""}`;
}

/** E-posta, Teams ya da wiki'ye yapıştırmak için haftalık rapor metni. */
export function weeklyMarkdown(report: WeekReport, { jiraBaseUrl, note, person }: { jiraBaseUrl?: string; note?: string; person?: string }): string {
  const t = report.totals;
  const out = [
    `## Haftalık rapor · Hafta ${weekNumber(report.week)} (${weekLabel(report.week)})${person ? ` · ${clean(person)}` : ""}`,
    "",
    `- **Kapattığım:** ${t.closed} madde · **${nf.format(t.effort)} SP** efor${t.missingEffort ? ` (${t.missingEffort} maddede efor girilmemiş)` : ""}`,
    `- **Bulduğum bug:** ${t.bugs}`,
    `- **Geri gönderdiğim:** ${t.returned} · **Beklemeye aldığım:** ${t.paused}`,
    `- **Başladığım:** ${t.started} · **Bana gelen:** ${t.received}`,
  ];
  for (const key of ["closed", "bugs", "returned", "paused"] as const) {
    const items = report.lists[key];
    if (!items.length) continue;
    out.push("", `### ${LIST_LABELS[key]} (${items.length})`, ...items.map((i) => line(i, jiraBaseUrl, key === "closed")));
  }
  const n = note?.trim();
  if (n) out.push("", "### Notlar", n);
  return `${out.join("\n")}\n`;
}
