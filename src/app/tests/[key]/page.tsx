import { ArrowLeft, ExternalLink, HelpCircle, ListChecks, ShieldAlert, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyCommand } from "@/components/copy-button";
import { Badge, Card, CardHeader, Notice } from "@/components/ui";
import { ISSUE_KEY_PATTERN, type IssueAnalysis } from "@/domain/analysis/schema";
import { formatDateTime } from "@/lib/format";
import { getAnalysisStore, jiraBrowseUrl } from "@/lib/server/context";
import { TestRunner } from "./test-runner";

export const dynamic = "force-dynamic";

const SEVERITY = { high: ["danger", "Yüksek"], medium: ["warning", "Orta"], low: ["neutral", "Düşük"] } as const;

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  return { title: (await params).key.toUpperCase() };
}

export default async function AnalysisPage({ params }: { params: Promise<{ key: string }> }) {
  const key = (await params).key.toUpperCase();
  if (!ISSUE_KEY_PATTERN.test(key)) notFound();
  const entry = await getAnalysisStore().load(key);
  if (!entry) notFound();
  const jiraUrl = jiraBrowseUrl(key);

  return (
    <>
      <Link href="/tests" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-text">
        <ArrowLeft className="size-4" /> Test Takibi
      </Link>
      {entry.ok ? (
        <AnalysisView analysis={entry.analysis} jiraUrl={jiraUrl} />
      ) : (
        <div className="space-y-4">
          <h1 className="font-mono text-2xl font-semibold">{key}</h1>
          <Notice tone="danger" title="Analiz dosyası şemaya uymuyor">
            <p className="mb-2">Claude Code&apos;da analizi yeniden oluşturun:</p>
            <CopyCommand value={`/jira-analiz ${key}`} />
            <ul className="mt-3 list-inside list-disc font-mono text-xs">
              {entry.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Notice>
        </div>
      )}
    </>
  );
}

function AnalysisView({ analysis, jiraUrl }: { analysis: IssueAnalysis; jiraUrl: string | undefined }) {
  const { issue, summary } = analysis;
  return (
    <div className="space-y-6">
      <header className="animate-in relative overflow-hidden rounded-3xl border border-border bg-surface p-6 shadow-card md:p-8">
        <div className="brand-grad pointer-events-none absolute -top-24 -right-24 size-64 rounded-full opacity-15 blur-2xl" aria-hidden />
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-accent-soft px-2 py-1 font-mono text-[13px] font-semibold text-accent-text">{issue.key}</span>
          {issue.issueType && <Badge>{issue.issueType}</Badge>}
          {issue.status && (
            <Badge tone="info" dot>
              {issue.status}
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-3">
            <CopyCommand value={`/jira-analiz ${issue.key}`} />
            {jiraUrl && (
              <a href={jiraUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline">
                Jira&apos;da aç <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        </div>
        <h1 className="mt-3 max-w-3xl text-2xl font-semibold leading-tight tracking-tight md:text-[28px]">{issue.summary}</h1>
        <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-muted">{summary.overview}</p>
        <p className="mt-4 flex items-center gap-1.5 text-xs text-subtle">
          <Sparkles className="size-3.5" /> {analysis.generatedBy} · {formatDateTime(analysis.generatedAt)}
          {issue.updated && <> · madde sürümü {formatDateTime(issue.updated)}</>}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader icon={ListChecks} title="Kabul kriterleri" />
          <div className="space-y-4 p-5 text-sm">
            {summary.acceptanceCriteria.length ? (
              <ul className="space-y-2">
                {summary.acceptanceCriteria.map((c) => (
                  <li key={c} className="flex gap-2">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                    {c}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">Maddede açık kabul kriteri yok.</p>
            )}
            {summary.affectedAreas.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-border pt-4">
                {summary.affectedAreas.map((a) => (
                  <Badge key={a}>{a}</Badge>
                ))}
              </div>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader icon={ShieldAlert} title="Riskler" />
          <div className="p-5">
            {analysis.risks.length === 0 ? (
              <p className="text-sm text-muted">Belirtilmiş risk yok.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {analysis.risks.map((r) => (
                  <li key={r.description} className="flex items-start gap-2.5">
                    <Badge tone={SEVERITY[r.severity][0]}>{SEVERITY[r.severity][1]}</Badge>
                    <span>{r.description}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader icon={HelpCircle} title="Açık sorular" description="Developer'a ya da analiste sorulacaklar" />
          <div className="p-5">
            {analysis.openQuestions.length === 0 ? (
              <p className="text-sm text-muted">Açık soru yok.</p>
            ) : (
              <ul className="space-y-2.5 text-sm">
                {analysis.openQuestions.map((q) => (
                  <li key={q} className="flex gap-2">
                    <HelpCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                    {q}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <TestRunner analysis={analysis} />
    </div>
  );
}
