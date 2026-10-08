"use client";

import { AlarmClock, ArrowRight, CheckCircle2, Hourglass, PackageCheck, PackageOpen, RefreshCw, Rocket, UserRoundSearch } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ReleaseProgress, TimingBadge } from "@/components/release-bits";
import { EnvMissing, ErrorPanel, NoProjects } from "@/components/states";
import { Avatar, Badge, Button, ButtonLink, Card, CardHeader, cn, EmptyState, IssueKey, LoadingRows, PageHeader, StatCard, StatusPill } from "@/components/ui";
import { setupState, useProjectReleases, useSettings } from "@/lib/client/queries";

const STORAGE_KEY = "qa.releases.project";

export function ReleasesView() {
  const settings = useSettings();
  const setup = setupState(settings.data);
  const [project, setProject] = useState<string>();

  useEffect(() => {
    if (!setup.projects.length || (project && setup.projects.includes(project))) return;
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(STORAGE_KEY);
    } catch {}
    setProject(remembered && setup.projects.includes(remembered) ? remembered : setup.projects[0]);
  }, [setup.projects, project]);

  const choose = (key: string) => {
    setProject(key);
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {}
  };

  const releases = useProjectReleases(setup.envOk ? project : undefined);
  const jiraBaseUrl = settings.data?.env.ok ? settings.data.env.jiraBaseUrl : undefined;
  const data = releases.data;
  const totals = data?.releases.reduce(
    (acc, r) => ({
      overdue: acc.overdue + (r.timing === "overdue" ? 1 : 0),
      soon: acc.soon + (r.timing === "soon" ? 1 : 0),
      ready: acc.ready + (r.readyToClose ? 1 : 0),
    }),
    { overdue: 0, soon: 0, ready: 0 },
  );
  const stale = data?.waitingInTest.filter((i) => i.staleInTest).length ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Release"
        title="Release'ler"
        description="Canlıya çıkmamış paketler, yaklaşan çıkışlar ve testte bekleyen maddeler."
        action={
          project && (
            <>
              <Button onClick={() => releases.refetch()} loading={releases.isFetching}>
                {!releases.isFetching && <RefreshCw className="size-4" />} Yenile
              </Button>
              <ButtonLink href={`/releases/close?project=${project}`} variant="primary">
                <Rocket className="size-4" /> Release kapat
              </ButtonLink>
            </>
          )
        }
      />

      {settings.data && !setup.envOk && <EnvMissing issues={settings.data.env.ok ? undefined : settings.data.env.issues} />}
      {setup.envOk && setup.projects.length === 0 && <NoProjects what="Release panosu" />}

      {setup.envOk && setup.projects.length > 0 && (
        <div className="space-y-6">
          {setup.projects.length > 1 && (
            <div className="flex flex-wrap gap-1 rounded-xl bg-surface-2 p-1">
              {setup.projects.map((k) => (
                <button
                  key={k}
                  onClick={() => choose(k)}
                  className={cn("rounded-lg px-3 py-1.5 text-[13px] font-medium", project === k ? "bg-surface shadow-card" : "text-muted hover:text-text")}
                >
                  <span className="font-mono">{k}</span>
                  <span className="ml-1.5 hidden text-muted sm:inline">{settings.data?.settings?.projects[k]?.name}</span>
                </button>
              ))}
            </div>
          )}

          {releases.isError && <ErrorPanel error={releases.error} />}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Çıkmamış release" value={data ? data.releases.length : "–"} icon={PackageOpen} tone="accent" />
            <StatCard label="Gecikmiş / yaklaşan" value={totals ? `${totals.overdue} / ${totals.soon}` : "–"} icon={AlarmClock} tone={totals?.overdue ? "danger" : "warning"} />
            <StatCard label="Kapatmaya hazır" value={totals ? totals.ready : "–"} icon={CheckCircle2} tone="success" hint="Tüm maddeler To be Deployed / Completed" />
            <StatCard label="Uzun süredir testte" value={data ? stale : "–"} icon={Hourglass} tone={stale ? "warning" : "neutral"} hint={`${settings.data?.settings?.preferences.staleTestDays ?? 5}+ gün`} />
          </div>

          {data && !data.project.mapped && (
            <Card className="p-4 text-sm">
              <span className="text-warning">Bu projede statü eşlemesi eksik.</span>{" "}
              <Link href="/settings#projects" className="font-medium text-accent-text hover:underline">
                Ayarlar&apos;dan tamamlayın
              </Link>{" "}
              — kapatmaya hazır olma bilgisi ve release kapatma için gerekli.
            </Card>
          )}

          {releases.isPending ? (
            <Card>
              <LoadingRows rows={4} />
            </Card>
          ) : data && data.releases.length === 0 ? (
            <Card>
              <EmptyState icon={PackageCheck} title="Çıkmamış release yok" description="Bu projede tüm versiyonlar kapatılmış." />
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {data?.releases.map((r) => (
                <Link
                  key={r.id}
                  href={`/releases/${r.id}`}
                  className="group block rounded-2xl border border-border bg-surface p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-pop"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold">{r.name}</h3>
                      {r.description && <p className="mt-0.5 line-clamp-1 text-[13px] text-muted">{r.description}</p>}
                    </div>
                    <TimingBadge release={r} />
                  </div>
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">{r.counts.total}</span>
                    <span className="text-sm text-muted">madde</span>
                    <span className="ml-auto text-xs text-subtle">
                      {r.counts.done} tamamlandı · {r.counts.inProgress} devam · {r.counts.todo} başlanmadı
                    </span>
                  </div>
                  <ReleaseProgress counts={r.counts} />
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {r.readyToClose === true && (
                      <Badge tone="success" dot>
                        Kapatmaya hazır
                      </Badge>
                    )}
                    {r.readyToClose === false && r.counts.total > 0 && <Badge tone="neutral">{r.counts.other} madde henüz hazır değil</Badge>}
                    {r.counts.inTest > 0 && <Badge tone="info">{r.counts.inTest} testte</Badge>}
                    {r.counts.staleInTest > 0 && <Badge tone="warning">{r.counts.staleInTest} uzun süredir testte</Badge>}
                    <ArrowRight className="ml-auto size-4 text-subtle transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Link>
              ))}
            </div>
          )}

          {data && data.waitingInTest.length > 0 && (
            <Card>
              <CardHeader icon={UserRoundSearch} title="Testte bekleyen maddeler" description="Statüsü 'testte' olarak eşlenen maddeler, en uzun bekleyen önce." />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-subtle">
                    <tr className="border-b border-border">
                      <th className="px-5 py-2.5 font-medium">Madde</th>
                      <th className="px-3 py-2.5 font-medium">Release</th>
                      <th className="px-3 py-2.5 font-medium">Statü</th>
                      <th className="px-3 py-2.5 font-medium">Testçi</th>
                      <th className="px-5 py-2.5 text-right font-medium">Bekleme</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.waitingInTest.slice(0, 50).map((i) => {
                      const tester = i.testAssignees[0] ?? i.assignee;
                      return (
                        <tr key={i.key} className="hover:bg-surface-2/60">
                          <td className="max-w-md px-5 py-3">
                            <IssueKey value={i.key} href={jiraBaseUrl ? `${jiraBaseUrl}/browse/${i.key}` : undefined} />
                            <p className="truncate text-[13px]">{i.summary}</p>
                          </td>
                          <td className="px-3 py-3 text-[13px] text-muted">{i.versionName}</td>
                          <td className="px-3 py-3">
                            <StatusPill name={i.status.name} category={i.status.category} />
                          </td>
                          <td className="px-3 py-3">
                            {tester ? (
                              <span className="flex items-center gap-2 text-[13px]">
                                <Avatar name={tester.displayName} url={tester.avatarUrl} size={22} /> {tester.displayName}
                              </span>
                            ) : (
                              <span className="text-xs text-subtle">—</span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <span className={cn("font-semibold tabular-nums", i.staleInTest ? "text-warning" : "text-muted")}>
                              {i.daysInStatus ?? "?"} gün
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
