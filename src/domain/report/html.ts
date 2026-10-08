import { PRIORITY_LABELS, TYPE_LABELS, type IssueAnalysis } from "@/domain/analysis/schema";
import { CASE_STATUS_LABELS, VERDICT_LABELS, summarizeRun, type CaseStatus, type TestRun } from "@/domain/testrun/schema";

/** HTML'e girecek her metin kaçışlanır: Jira ve analiz içeriği güvenilmezdir. */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const safeHref = (href: string | undefined): string | undefined => {
  if (!href) return undefined;
  try {
    const u = new URL(href);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
};

const fmt = (iso: string | undefined) => {
  if (!iso) return "";
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeStyle: "short" }).format(ms);
};

export type ReportInput = {
  analysis: IssueAnalysis;
  run: TestRun | undefined;
  issueUrl?: string;
  tester: string;
  generatedAt: string;
};

export function reportFilename(issueKey: string, generatedAt: string): string {
  return `test-raporu-${issueKey}-${generatedAt.slice(0, 10)}.html`;
}

const STATUS_CLASS: Record<CaseStatus, string> = {
  pending: "s-pending",
  passed: "s-passed",
  failed: "s-failed",
  blocked: "s-blocked",
  skipped: "s-skipped",
};

export function renderReport({ analysis, run, issueUrl, tester, generatedAt }: ReportInput): string {
  const summary = summarizeRun(analysis, run);
  const href = safeHref(issueUrl);
  const verdictClass =
    summary.verdict === "passed" ? "v-passed" : summary.verdict === "failed" ? "v-failed" : summary.verdict === "blocked" ? "v-blocked" : "v-progress";
  const pct = (n: number) => (summary.total ? (n / summary.total) * 100 : 0);

  const segments = (["passed", "failed", "blocked", "skipped", "pending"] as const)
    .filter((s) => summary.counts[s] > 0)
    .map((s) => `<span class="seg ${STATUS_CLASS[s]}" style="width:${pct(summary.counts[s]).toFixed(2)}%" title="${esc(CASE_STATUS_LABELS[s])}: ${summary.counts[s]}"></span>`)
    .join("");

  const stat = (label: string, value: number, cls: string) =>
    `<div class="stat ${cls}"><div class="stat-value">${value}</div><div class="stat-label">${esc(label)}</div></div>`;

  const cases = analysis.testCases
    .map((tc) => {
      const result = run?.results[tc.id];
      const status = result?.status ?? "pending";
      const steps = tc.steps
        .map((s, i) => `<tr><td class="num">${i + 1}</td><td>${esc(s.action)}</td><td>${esc(s.expected)}</td></tr>`)
        .join("");
      return `
      <article class="case">
        <header class="case-head">
          <span class="case-id">${esc(tc.id)}</span>
          <h3>${esc(tc.title)}</h3>
          <span class="pill ${STATUS_CLASS[status]}">${esc(CASE_STATUS_LABELS[status])}</span>
        </header>
        <div class="case-meta">
          <span class="tag">${esc(TYPE_LABELS[tc.type])}</span>
          <span class="tag">Öncelik: ${esc(PRIORITY_LABELS[tc.priority])}</span>
          ${tc.assumption ? `<span class="tag warn">Varsayım</span>` : ""}
        </div>
        ${tc.preconditions.length ? `<p class="label">Ön koşullar</p><ul>${tc.preconditions.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
        <table class="steps"><thead><tr><th class="num">#</th><th>Eylem</th><th>Beklenen sonuç</th></tr></thead><tbody>${steps}</tbody></table>
        ${result?.note ? `<div class="note"><span class="label">Test notu</span><p>${esc(result.note).replace(/\n/g, "<br>")}</p></div>` : ""}
      </article>`;
    })
    .join("");

  const failing = analysis.testCases.filter((tc) => {
    const s = run?.results[tc.id]?.status;
    return s === "failed" || s === "blocked";
  });

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<meta name="referrer" content="no-referrer">
<title>Test Raporu · ${esc(analysis.issue.key)}</title>
<style>
:root{--bg:#f6f7fb;--surface:#fff;--border:#e4e7ef;--text:#1b1f2e;--muted:#667085;--accent:#4f46e5;--passed:#12a150;--failed:#e5484d;--blocked:#d97706;--skipped:#8b8fa3;--pending:#c5c9d6;--passed-soft:#e7f7ee;--failed-soft:#fdecec;--blocked-soft:#fef3e2;--skipped-soft:#f0f1f5;--accent-soft:#eef0ff}
@media (prefers-color-scheme:dark){:root{--bg:#0f1117;--surface:#171a23;--border:#2a2f3d;--text:#e8eaf1;--muted:#9aa1b5;--accent:#8b85ff;--passed-soft:#10301f;--failed-soft:#3a1618;--blocked-soft:#3a2810;--skipped-soft:#23262f;--pending:#3a3f4f;--accent-soft:#1f2040}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 "Segoe UI Variable","Segoe UI",system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:980px;margin:0 auto;padding:40px 20px 64px}
.hero{background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 55%,#db2777 120%);color:#fff;border-radius:20px;padding:32px;position:relative;overflow:hidden}
.hero:after{content:"";position:absolute;right:-60px;top:-60px;width:220px;height:220px;border-radius:50%;background:rgba(255,255,255,.08)}
.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.8;margin:0 0 8px}
.hero h1{margin:0;font-size:26px;line-height:1.25;font-weight:650;max-width:720px}
.hero .meta{margin-top:14px;display:flex;flex-wrap:wrap;gap:8px 18px;font-size:13px;opacity:.92}
.hero a{color:#fff}
.verdict{display:inline-flex;align-items:center;gap:8px;margin-top:20px;padding:8px 14px;border-radius:999px;background:rgba(255,255,255,.16);font-weight:600;backdrop-filter:blur(4px)}
.verdict:before{content:"";width:10px;height:10px;border-radius:50%;background:#fff}
.v-passed:before{background:#4ade80}.v-failed:before{background:#fb7185}.v-blocked:before{background:#fbbf24}.v-progress:before{background:#c7d2fe}
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:20px 0 12px}
@media (max-width:640px){.stats{grid-template-columns:repeat(2,1fr)}}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px 16px}
.stat-value{font-size:24px;font-weight:700;line-height:1.1}
.stat-label{color:var(--muted);font-size:12px;margin-top:2px}
.stat.passed .stat-value{color:var(--passed)}.stat.failed .stat-value{color:var(--failed)}.stat.blocked .stat-value{color:var(--blocked)}.stat.skipped .stat-value{color:var(--skipped)}
.bar{display:flex;height:10px;border-radius:999px;overflow:hidden;background:var(--pending);margin-bottom:28px}
.seg{display:block;height:100%}
.s-passed.seg{background:var(--passed)}.s-failed.seg{background:var(--failed)}.s-blocked.seg{background:var(--blocked)}.s-skipped.seg{background:var(--skipped)}.s-pending.seg{background:var(--pending)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:22px 24px;margin-bottom:16px}
.card h2{margin:0 0 10px;font-size:16px}
.label{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:14px 0 6px;font-weight:600}
ul{margin:0;padding-left:20px}li{margin:3px 0}
.alert{border-left:4px solid var(--failed);background:var(--failed-soft)}
.case{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:18px 22px;margin-bottom:14px;break-inside:avoid}
.case-head{display:flex;align-items:center;gap:12px}
.case-head h3{margin:0;font-size:15px;flex:1}
.case-id{font:600 12px/1 "Cascadia Code",ui-monospace,monospace;color:var(--muted);background:var(--skipped-soft);padding:5px 8px;border-radius:8px}
.case-meta{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px}
.tag{font-size:12px;color:var(--muted);background:var(--skipped-soft);padding:2px 8px;border-radius:6px}
.tag.warn{color:var(--blocked);background:var(--blocked-soft)}
.pill{font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap}
.pill.s-passed{color:var(--passed);background:var(--passed-soft)}.pill.s-failed{color:var(--failed);background:var(--failed-soft)}.pill.s-blocked{color:var(--blocked);background:var(--blocked-soft)}.pill.s-skipped,.pill.s-pending{color:var(--muted);background:var(--skipped-soft)}
table.steps{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
.steps th{text-align:left;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--border)}
.steps td{padding:9px 10px;border-bottom:1px solid var(--border);vertical-align:top}
.steps tr:last-child td{border-bottom:0}
.num{width:36px;color:var(--muted)}
.note{margin-top:12px;background:var(--accent-soft);border-radius:10px;padding:10px 14px}
.note .label{margin-top:0}.note p{margin:0}
footer{margin-top:32px;color:var(--muted);font-size:12px;text-align:center}
@media print{body{background:#fff}.hero{-webkit-print-color-adjust:exact;print-color-adjust:exact}.wrap{padding:0}}
</style>
</head>
<body>
<main class="wrap">
  <section class="hero">
    <p class="eyebrow">Test Sonuç Raporu</p>
    <h1>${esc(analysis.issue.key)} — ${esc(analysis.issue.summary)}</h1>
    <div class="meta">
      <span>Testçi: <strong>${esc(tester)}</strong></span>
      ${run?.environment ? `<span>Ortam: <strong>${esc(run.environment)}</strong></span>` : ""}
      <span>Rapor tarihi: ${esc(fmt(generatedAt))}</span>
      ${href ? `<a href="${esc(href)}" rel="noreferrer noopener">Jira'da aç ↗</a>` : ""}
    </div>
    <div class="verdict ${verdictClass}">Sonuç: ${esc(VERDICT_LABELS[summary.verdict])}</div>
  </section>

  <div class="stats">
    ${stat("Toplam", summary.total, "")}
    ${stat("Başarılı", summary.counts.passed, "passed")}
    ${stat("Başarısız", summary.counts.failed, "failed")}
    ${stat("Bloke", summary.counts.blocked, "blocked")}
    ${stat("Atlandı", summary.counts.skipped, "skipped")}
  </div>
  <div class="bar" role="img" aria-label="Sonuç dağılımı">${segments}</div>

  ${
    failing.length
      ? `<section class="card alert"><h2>Dikkat gerektiren case'ler</h2><ul>${failing
          .map((tc) => `<li><strong>${esc(tc.id)}</strong> ${esc(tc.title)} — ${esc(CASE_STATUS_LABELS[run?.results[tc.id]?.status ?? "pending"])}${run?.results[tc.id]?.note ? `: ${esc(run.results[tc.id]?.note)}` : ""}</li>`)
          .join("")}</ul></section>`
      : ""
  }

  <section class="card">
    <h2>Madde özeti</h2>
    <p>${esc(analysis.summary.overview)}</p>
    ${analysis.summary.acceptanceCriteria.length ? `<span class="label">Kabul kriterleri</span><ul>${analysis.summary.acceptanceCriteria.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
    ${analysis.summary.affectedAreas.length ? `<span class="label">Etkilenen alanlar</span><p>${analysis.summary.affectedAreas.map(esc).join(" · ")}</p>` : ""}
  </section>

  <h2 style="font-size:16px;margin:28px 0 12px">Test case'ler</h2>
  ${cases}

  <footer>QA Asistanı ile oluşturuldu · ${esc(fmt(generatedAt))}</footer>
</main>
</body>
</html>`;
}
