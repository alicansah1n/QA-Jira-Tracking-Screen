"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  Circle,
  ClipboardList,
  FolderKanban,
  Inbox,
  KeyRound,
  MessageSquareQuote,
  PackageOpen,
  Sparkles,
  Tags,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CopyCommand } from "@/components/copy-button";
import { ReleaseProgress, TimingBadge } from "@/components/release-bits";
import { EnvMissing, ErrorPanel } from "@/components/states";
import { Badge, ButtonLink, Card, CardHeader, cn, EmptyState, IssueKey, LoadingRows, Skeleton, StatCard, StatusPill } from "@/components/ui";
import type { InboxItem } from "@/domain/inbox/service";
import { api } from "@/lib/client/api";
import { setupState, useInbox, useProjectReleases, useSettings } from "@/lib/client/queries";
import { formatRelative, greeting } from "@/lib/format";

type Me = { connected: true; displayName: string } | { connected: false };

export function DashboardView() {
  // Tarih ve selamlama yalnızca tarayıcıda hesaplanır; sunucuda farklı saat/biçim hydration hatasına yol açar.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  const settings = useSettings();
  const setup = setupState(settings.data);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me"), staleTime: 5 * 60_000, enabled: setup.envOk });
  const inbox = useInbox(setup.envOk);
  const firstProject = setup.projects[0];
  const releases = useProjectReleases(setup.envOk ? firstProject : undefined);
  const jiraBaseUrl = settings.data?.env.ok ? settings.data.env.jiraBaseUrl : undefined;

  const items = inbox.data?.items ?? [];
  const isNew = items.filter((i) => i.isNew);
  const requests = items.filter((i) => i.devRequest.eligibility.eligible && i.devRequest.ledger?.state !== "sent" && i.devRequest.ledger?.state !== "skipped");
  const needsAnalysis = items.filter((i) => i.analysis.state !== "ok");
  const ready = items.filter((i) => i.analysis.state === "ok");
  const name = me.data?.connected ? me.data.displayName.split(" ")[0] : undefined;

  const steps = [
    { done: setup.envOk, title: "Jira bağlantısı", detail: ".env.local dosyası", icon: KeyRound, href: "/settings" },
    { done: setup.fieldsMapped, title: "Alan eşlemesi", detail: "Developer, Test Assignee, StoryPointTest", icon: Tags, href: "/settings" },
    { done: setup.projects.length > 0 && setup.statusesMapped, title: "Proje ve statüler", detail: "To be Deployed, Completed, testte", icon: FolderKanban, href: "/settings#projects" },
    { done: setup.teams > 0, title: "Teams kanalı", detail: "Opsiyonel bildirimler", icon: BellRing, href: "/settings" },
  ];
  const setupDone = steps.filter((s) => s.done).length;

  return (
    <>
      <section className="animate-in relative mb-8 overflow-hidden rounded-3xl p-7 text-white shadow-pop md:p-9">
        <div className="brand-grad absolute inset-0" aria-hidden />
        <div className="absolute -top-20 -right-10 size-72 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="absolute -bottom-24 left-1/3 size-72 rounded-full bg-fuchsia-300/20 blur-3xl" aria-hidden />
        <div className="relative">
          <p className="min-h-5 text-sm text-white/80">{now && new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" }).format(now)}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-[34px]">
            {now ? greeting(now) : "Merhaba"}
            {name ? `, ${name}` : ""} 👋
          </h1>
          <p className="mt-2 max-w-xl text-[15px] text-white/85">
            {!setup.envOk
              ? "Başlamak için Jira bağlantısını kuralım."
              : inbox.isPending
                ? "İşleriniz yükleniyor…"
                : items.length === 0
                  ? "Size atanmış açık madde yok. Keyifli bir gün!"
                  : `${items.length} açık maddeniz var${isNew.length ? `, ${isNew.length} tanesi son 24 saatte geldi` : ""}.`}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/inbox" className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-[oklch(0.4_0.2_277)] shadow-sm transition hover:bg-white/90">
              <Inbox className="size-4" /> Gelen kutusu
            </Link>
            <Link href="/releases" className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-medium backdrop-blur transition hover:bg-white/25">
              <PackageOpen className="size-4" /> Release&apos;ler
            </Link>
          </div>
        </div>
      </section>

      {settings.data && !setup.envOk && <EnvMissing issues={settings.data.env.ok ? undefined : settings.data.env.issues} />}

      {setup.envOk && (
        <div className="space-y-8">
          {inbox.isError && <ErrorPanel error={inbox.error} />}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Açık maddelerim" value={inbox.data ? items.length : <Skeleton className="h-7 w-10" />} icon={Inbox} tone="accent" href="/inbox" />
            <StatCard label="Son 24 saatte yeni" value={inbox.data ? isNew.length : <Skeleton className="h-7 w-10" />} icon={Sparkles} tone="info" href="/inbox" />
            <StatCard
              label="Bilgi talebi bekleyen"
              value={inbox.data ? requests.length : <Skeleton className="h-7 w-10" />}
              icon={MessageSquareQuote}
              tone={requests.length ? "warning" : "neutral"}
              href="/inbox"
              hint="Component ve yorumu olmayan"
            />
            <StatCard
              label="Analiz bekleyen"
              value={inbox.data ? needsAnalysis.length : <Skeleton className="h-7 w-10" />}
              icon={Wand2}
              tone={needsAnalysis.length ? "accent" : "neutral"}
              href="/inbox"
              hint="Claude Code'da /jira-analiz"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader
                icon={ClipboardList}
                title="Bugün odaklan"
                description="Yeni gelenler ve teste hazır maddeler"
                action={
                  <ButtonLink href="/inbox" size="sm" variant="ghost">
                    Tümü <ArrowRight className="size-3.5" />
                  </ButtonLink>
                }
              />
              {inbox.isPending ? (
                <LoadingRows rows={4} />
              ) : items.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="Her şey yolunda" description="Size atanmış açık madde yok." />
              ) : (
                <ul className="divide-y divide-border">
                  {focusList(isNew, ready, needsAnalysis).map((i) => (
                    <FocusItem key={i.key} item={i} jiraBaseUrl={jiraBaseUrl} />
                  ))}
                </ul>
              )}
            </Card>

            <div className="space-y-6">
              {setupDone < steps.length && (
                <Card>
                  <CardHeader title="Kurulum" description={`${setupDone}/${steps.length} adım tamamlandı`} />
                  <ul className="divide-y divide-border">
                    {steps.map((s) => (
                      <li key={s.title}>
                        <Link href={s.href} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2/60">
                          {s.done ? <CheckCircle2 className="size-5 text-success" /> : <Circle className="size-5 text-subtle" />}
                          <div className="min-w-0 flex-1">
                            <p className={cn("text-sm font-medium", s.done && "text-muted line-through")}>{s.title}</p>
                            <p className="text-xs text-subtle">{s.detail}</p>
                          </div>
                          {!s.done && <ArrowRight className="size-4 text-subtle" />}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              <Card>
                <CardHeader
                  icon={PackageOpen}
                  title="Yaklaşan release'ler"
                  description={firstProject ? settings.data?.settings?.projects[firstProject]?.name : "Takip edilen proje yok"}
                  action={
                    firstProject && (
                      <ButtonLink href="/releases" size="sm" variant="ghost">
                        Tümü <ArrowRight className="size-3.5" />
                      </ButtonLink>
                    )
                  }
                />
                {!firstProject ? (
                  <div className="p-5 text-sm text-muted">
                    <Link href="/settings#projects" className="font-medium text-accent-text hover:underline">
                      Ayarlar&apos;dan proje ekleyin
                    </Link>{" "}
                    — release panosu ve release kapatma bu projeler için çalışır.
                  </div>
                ) : releases.isPending ? (
                  <LoadingRows rows={3} />
                ) : releases.isError ? (
                  <div className="p-4">
                    <ErrorPanel error={releases.error} />
                  </div>
                ) : releases.data.releases.length === 0 ? (
                  <p className="p-5 text-sm text-muted">Çıkmamış release yok.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {releases.data.releases.slice(0, 4).map((r) => (
                      <li key={r.id}>
                        <Link href={`/releases/${r.id}`} className="block px-5 py-3.5 transition-colors hover:bg-surface-2/60">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-semibold">{r.name}</span>
                            <TimingBadge release={r} />
                          </div>
                          <ReleaseProgress counts={r.counts} />
                          <p className="mt-1.5 text-xs text-subtle">
                            {r.counts.total} madde{r.readyToClose ? " · kapatmaya hazır" : ""}
                            {r.counts.staleInTest ? ` · ${r.counts.staleInTest} uzun süredir testte` : ""}
                          </p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function focusList(isNew: InboxItem[], ready: InboxItem[], needsAnalysis: InboxItem[]): InboxItem[] {
  const seen = new Set<string>();
  const out: InboxItem[] = [];
  for (const i of [...isNew, ...ready, ...needsAnalysis]) {
    if (seen.has(i.key)) continue;
    seen.add(i.key);
    out.push(i);
    if (out.length >= 7) break;
  }
  return out;
}

function FocusItem({ item, jiraBaseUrl }: { item: InboxItem; jiraBaseUrl?: string }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <IssueKey value={item.key} href={jiraBaseUrl ? `${jiraBaseUrl}/browse/${item.key}` : undefined} />
          {item.isNew && (
            <Badge tone="accent" dot>
              Yeni
            </Badge>
          )}
          <span className="text-xs text-subtle">{formatRelative(item.updated)}</span>
        </div>
        <p className="mt-0.5 truncate text-sm font-medium">{item.summary}</p>
        {item.analysis.overview && <p className="mt-0.5 line-clamp-1 text-xs text-muted">{item.analysis.overview}</p>}
      </div>
      <StatusPill name={item.status.name} category={item.status.category} />
      {item.analysis.state === "ok" ? (
        <ButtonLink href={`/tests/${item.key}`} size="sm" variant="primary">
          Test et
        </ButtonLink>
      ) : (
        <CopyCommand value={`/jira-analiz ${item.key}`} />
      )}
    </li>
  );
}
