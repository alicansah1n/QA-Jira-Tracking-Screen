"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleDot, Clock3, Rocket, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { CopyCommand } from "@/components/copy-button";
import { IssueLine } from "@/components/issue-line";
import { ReleaseProgress, TimingBadge } from "@/components/release-bits";
import { ErrorPanel } from "@/components/states";
import { Badge, ButtonLink, Card, CardHeader, LoadingRows, Notice, StatCard } from "@/components/ui";
import type { ReleaseIssue, ReleaseSummary } from "@/domain/releases/service";
import { api } from "@/lib/client/api";
import { qk, useSettings } from "@/lib/client/queries";
import { formatDate } from "@/lib/format";

type Detail = {
  project: { key: string; name: string; tracked: boolean; mapped: boolean };
  release: ReleaseSummary & { released: boolean };
  issues: ReleaseIssue[];
};

const GROUPS: { key: ReleaseIssue["readiness"]; title: string; description: string; tone: "success" | "info" | "warning" }[] = [
  { key: "other", title: "Henüz hazır değil", description: "To be Deployed ya da Completed dışındaki maddeler — release kapatmayı engeller.", tone: "warning" },
  { key: "to-be-deployed", title: "To be Deployed", description: "Release kapatılınca Completed yapılacak.", tone: "info" },
  { key: "completed", title: "Completed", description: "Dokunulmayacak.", tone: "success" },
];

export function ReleaseDetailView({ id }: { id: string }) {
  const settings = useSettings();
  const jiraBaseUrl = settings.data?.env.ok ? settings.data.env.jiraBaseUrl : undefined;
  const q = useQuery({ queryKey: qk.release(id), queryFn: () => api<Detail>(`/api/releases/${id}`) });

  if (q.isPending) return <Card><LoadingRows rows={6} /></Card>;
  if (q.isError) return <ErrorPanel error={q.error} />;
  const { release, project, issues } = q.data;

  return (
    <>
      <Link href="/releases" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" /> Release&apos;ler
      </Link>

      <header className="animate-in relative mb-6 overflow-hidden rounded-3xl border border-border bg-surface p-6 shadow-card md:p-8">
        <div className="brand-grad pointer-events-none absolute -top-24 -right-24 size-64 rounded-full opacity-15 blur-2xl" aria-hidden />
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-accent-soft px-2 py-1 font-mono text-[13px] font-semibold text-accent-text">{project.key}</span>
          <span className="text-sm text-muted">{project.name}</span>
          <TimingBadge release={release} />
          {release.released && <Badge tone="success">Kapatılmış</Badge>}
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">{release.name}</h1>
            {release.description && <p className="mt-1 max-w-2xl text-muted">{release.description}</p>}
            {release.releaseDate && <p className="mt-2 text-sm text-subtle">Planlanan çıkış: {formatDate(release.releaseDate)}</p>}
          </div>
          {!release.released && (
            <ButtonLink href={`/releases/close?project=${project.key}&version=${release.id}`} variant={release.readyToClose ? "primary" : "secondary"} size="lg">
              <Rocket className="size-4" /> Bu release&apos;i kapat
            </ButtonLink>
          )}
        </div>
        <div className="mt-6">
          <ReleaseProgress counts={release.counts} />
        </div>
      </header>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Toplam madde" value={release.counts.total} icon={CircleDot} tone="accent" />
        <StatCard label="To be Deployed" value={release.counts.toBeDeployed} icon={ArrowRight} tone="info" />
        <StatCard label="Hazır değil" value={release.counts.other} icon={TriangleAlert} tone={release.counts.other ? "warning" : "neutral"} />
        <StatCard label="Uzun süredir testte" value={release.counts.staleInTest} icon={Clock3} tone={release.counts.staleInTest ? "warning" : "neutral"} />
      </div>

      {!project.mapped && (
        <div className="mb-6">
          <Notice tone="warning" title="Bu projenin statü eşlemesi eksik">
            Gruplama ve release kapatma için <Link href="/settings#projects" className="font-medium underline">Ayarlar</Link>&apos;dan To be Deployed ve Completed statülerini seçin.
          </Notice>
        </div>
      )}

      <div className="space-y-6">
        {GROUPS.map((g) => {
          const list = issues.filter((i) => i.readiness === g.key);
          if (!list.length) return null;
          return (
            <Card key={g.key}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    {g.title} <Badge tone={g.tone}>{list.length}</Badge>
                  </span>
                }
                description={g.description}
              />
              <div className="divide-y divide-border">
                {list.map((i) => (
                  <IssueLine
                    key={i.key}
                    issue={i}
                    jiraBaseUrl={jiraBaseUrl}
                    badges={
                      <>
                        {i.inTest && i.daysInStatus !== undefined && (
                          <Badge tone={i.staleInTest ? "warning" : "info"}>
                            <Clock3 className="size-3" /> {i.daysInStatus} gündür testte
                          </Badge>
                        )}
                        {i.analysis === "stale" && <Badge tone="warning">Analiz eskidi</Badge>}
                      </>
                    }
                    actions={
                      i.analysis === "ok" ? (
                        <ButtonLink href={`/tests/${i.key}`} size="sm">
                          Test <ArrowRight className="size-3.5" />
                        </ButtonLink>
                      ) : g.key === "completed" ? (
                        <CheckCircle2 className="size-4 text-success" />
                      ) : (
                        <CopyCommand value={`/jira-analiz ${i.key}`} />
                      )
                    }
                  />
                ))}
              </div>
            </Card>
          );
        })}
        {issues.length === 0 && (
          <Notice tone="info" title="Bu release'te madde yok" />
        )}
      </div>
    </>
  );
}
