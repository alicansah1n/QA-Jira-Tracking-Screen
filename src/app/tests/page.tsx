import { AlertTriangle, ChevronRight, ClipboardCheck, Terminal } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CopyCommand } from "@/components/copy-button";
import { Badge, Card, EmptyState, IssueKey, Notice, PageHeader, SegmentBar } from "@/components/ui";
import type { AnalysisEntry } from "@/domain/analysis/store";
import { summarizeRun, VERDICT_LABELS, type RunSummary, type Verdict } from "@/domain/testrun/schema";
import { loadEnv } from "@/lib/config/env";
import { formatRelative } from "@/lib/format";
import { getAnalysisStore, getContext } from "@/lib/server/context";
import { JsonImport } from "./json-import";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Test Takibi" };

const VERDICT_TONE: Record<Verdict, "success" | "danger" | "warning" | "info" | "neutral"> = {
  passed: "success",
  failed: "danger",
  blocked: "warning",
  "in-progress": "info",
  "not-started": "neutral",
};

type Row = { entry: AnalysisEntry; summary?: RunSummary; closedAt?: string };

async function loadRows(): Promise<{ rows: Row[]; error?: string }> {
  try {
    const entries = await getAnalysisStore().list();
    const ctx = loadEnv().ok ? getContext() : undefined;
    const rows = await Promise.all(
      entries.map(async (entry): Promise<Row> => {
        if (!entry.ok || !ctx) return { entry };
        const run = (await ctx.run(entry.key).read().catch(() => null)) ?? undefined;
        return { entry, summary: summarizeRun(entry.analysis, run), closedAt: run?.closedAt };
      }),
    );
    return { rows };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : "Analizler okunamadı" };
  }
}

export default async function TestsPage() {
  const { rows, error } = await loadRows();

  return (
    <>
      <PageHeader
        eyebrow="Günlük iş"
        title="Test Takibi"
        description="Claude Code'da üretilen analizler ve test case'ler. Case'leri işaretleyin, raporu oluşturun, maddeyi kapatın."
        action={<JsonImport />}
      />

      {error && (
        <div className="mb-6">
          <Notice tone="danger" title={error} />
        </div>
      )}

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={ClipboardCheck}
            title="Henüz analiz yok"
            description={
              <>
                <p>Analizler Claude Code sohbetinde oluşturulur; uygulama bir AI servisine bağlanmaz.</p>
                <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-left">
                  <Terminal className="size-4 text-subtle" />
                  <span className="text-[13px]">Claude Code&apos;da yazın:</span>
                  <CopyCommand value="/jira-analiz PROJ-123" />
                </div>
              </>
            }
          />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {rows.map(({ entry, summary, closedAt }) => (
              <li key={entry.key}>
                <Link href={`/tests/${entry.key}`} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 transition-colors hover:bg-surface-2/60">
                  <div className="w-28 shrink-0">
                    <IssueKey value={entry.key} />
                  </div>
                  <div className="min-w-0 flex-1">
                    {entry.ok ? (
                      <>
                        <p className="truncate text-sm font-medium">{entry.analysis.issue.summary}</p>
                        <p className="text-xs text-subtle">
                          {entry.analysis.testCases.length} test case · analiz {formatRelative(entry.analysis.generatedAt)}
                        </p>
                      </>
                    ) : (
                      <p className="flex items-center gap-1.5 text-sm text-danger">
                        <AlertTriangle className="size-4" /> Geçersiz analiz dosyası ({entry.errors.length} hata)
                      </p>
                    )}
                  </div>
                  {summary && (
                    <div className="flex w-full items-center gap-3 sm:w-64">
                      <SegmentBar
                        total={summary.total}
                        segments={[
                          { label: "Başarılı", value: summary.counts.passed, className: "bg-success" },
                          { label: "Başarısız", value: summary.counts.failed, className: "bg-danger" },
                          { label: "Bloke", value: summary.counts.blocked, className: "bg-warning" },
                          { label: "Atlandı", value: summary.counts.skipped, className: "bg-subtle" },
                        ]}
                      />
                      <span className="w-10 text-right text-xs tabular-nums text-muted">%{summary.progress}</span>
                    </div>
                  )}
                  <div className="flex w-32 justify-end">
                    {closedAt ? (
                      <Badge tone="success" dot>
                        Kapatıldı
                      </Badge>
                    ) : summary ? (
                      <Badge tone={VERDICT_TONE[summary.verdict]} dot>
                        {VERDICT_LABELS[summary.verdict]}
                      </Badge>
                    ) : null}
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
