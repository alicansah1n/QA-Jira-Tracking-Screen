"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleCheckBig,
  CirclePause,
  FlaskConical,
  Inbox,
  Info,
  ListTodo,
  OctagonAlert,
  PackageOpen,
  RefreshCw,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ColumnChart, Delta } from "@/components/charts";
import { HelpButton } from "@/components/modal";
import { ReleaseProgress, TimingBadge } from "@/components/release-bits";
import { EnvMissing, ErrorPanel } from "@/components/states";
import { Badge, Button, ButtonLink, Card, cn, IssueKey, LoadingRows, Skeleton } from "@/components/ui";
import {
  ageTone,
  buildActions,
  buildQueue,
  isHighPriority,
  OLD_PAUSED_DAYS,
  relevantReleases,
  type Action,
  type QueueItem,
  type QueueTab,
  type Severity,
} from "@/domain/dashboard/insights";
import type { InboxItem } from "@/domain/inbox/service";
import { testStatusMatcher } from "@/domain/issues/stage";
import { weekLabel, weekNumber, weekShortLabel } from "@/domain/weekly/week";
import { api } from "@/lib/client/api";
import { qk, setupState, useInbox, useProjectReleases, useSettings, useWeeklyHistory, type WeeklyHistory } from "@/lib/client/queries";
import { formatRelative, greeting } from "@/lib/format";

type Me = { connected: true; displayName: string } | { connected: false };

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

/** Panoda gösterilen hafta sayısı (geçmiş verisinin son haftaları). */
const CHART_WEEKS = 8;
const QUEUE_LIMIT = 8;

export function DashboardView() {
  // Tarih ve selamlama yalnızca tarayıcıda hesaplanır; sunucuda farklı saat/biçim hydration hatasına yol açar.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  const router = useRouter();
  const queryClient = useQueryClient();
  const settings = useSettings();
  const setup = setupState(settings.data);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me"), staleTime: 5 * 60_000, enabled: setup.envOk });
  const inbox = useInbox(setup.envOk);
  const history = useWeeklyHistory(setup.envOk);
  const firstProject = setup.projects[0];
  const releases = useProjectReleases(setup.envOk ? firstProject : undefined);
  const jiraBaseUrl = settings.data?.env.ok ? settings.data.env.jiraBaseUrl : undefined;
  const saved = settings.data?.settings;
  const staleDays = saved?.preferences.staleTestDays ?? 5;

  const isTest = useMemo(() => testStatusMatcher(Object.values(saved?.projects ?? {}).flatMap((p) => p.inTest.map((s) => s.id))), [saved]);
  const queue = useMemo(() => (now && inbox.data ? buildQueue(inbox.data.items, isTest, now.getTime()) : undefined), [inbox.data, isTest, now]);
  const weeks = history.data?.weeks;
  const thisWeek = weeks?.at(-1);
  const lastWeek = weeks?.at(-2);
  const actions = useMemo(
    () => (queue ? buildActions({ queue, releases: releases.data?.releases, staleTestDays: staleDays, missingEffort: thisWeek?.totals.missingEffort }) : []),
    [queue, releases.data, staleDays, thisWeek],
  );

  const [tab, setTab] = useState<QueueTab>("test");
  const queueRef = useRef<HTMLDivElement>(null);
  const openTab = (t: QueueTab) => {
    setTab(t);
    queueRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const name = me.data?.connected ? me.data.displayName.split(" ")[0] : undefined;
  const refreshing = inbox.isFetching || history.isFetching || releases.isFetching;
  const refresh = () => {
    setNow(new Date());
    void queryClient.invalidateQueries({ queryKey: qk.inbox });
    void queryClient.invalidateQueries({ queryKey: qk.weeklyHistory });
    if (firstProject) void queryClient.invalidateQueries({ queryKey: qk.releases(firstProject) });
  };

  const steps = [
    { done: setup.envOk, title: "Jira bağlantısı", href: "/settings" },
    { done: setup.fieldsMapped, title: "Alan eşlemesi", href: "/settings#alanlar" },
    { done: setup.projects.length > 0 && setup.statusesMapped, title: "Proje ve statüler", href: "/settings#projects" },
  ];
  const setupMissing = steps.filter((s) => !s.done);

  const by = (stage: QueueTab) => queue?.filter((i) => i.stage === stage) ?? [];
  const inTest = by("test");
  const fresh = by("new");
  const paused = by("paused");
  const staleCount = inTest.filter((i) => i.days >= staleDays).length;

  return (
    <>
      {/* ── Başlık ───────────────────────────────────────────────────────── */}
      <header className="animate-in mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-1 min-h-5 text-xs font-medium tracking-[0.08em] text-accent-text uppercase">
            {now && `${new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" }).format(now)}${history.data ? ` · Hafta ${weekNumber(history.data.currentWeek)}` : ""}`}
          </p>
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight">
            {now ? greeting(now) : "Merhaba"}
            {name ? `, ${name}` : ""}
          </h1>
          {setup.envOk && (
            <p className="mt-1 min-h-5 text-sm text-muted">
              {inbox.dataUpdatedAt ? `Jira verisi ${formatRelative(new Date(inbox.dataUpdatedAt).toISOString())} alındı` : "Jira'dan okunuyor…"}
            </p>
          )}
        </div>
        {setup.envOk && (
          <div className="flex items-center gap-2">
            <ButtonLink href="/reports">
              <CalendarRange className="size-4" /> Haftalık rapor
            </ButtonLink>
            <Button onClick={refresh} aria-label="Verileri yenile">
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} /> Yenile
            </Button>
          </div>
        )}
      </header>

      {settings.data && !setup.envOk && <EnvMissing issues={settings.data.env.ok ? undefined : settings.data.env.issues} />}

      {setup.envOk && (
        <div className="space-y-6">
          {setupMissing.length > 0 && (
            <Card className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <span className="text-sm font-medium">Kurulum eksik:</span>
              {setupMissing.map((s) => (
                <Link key={s.title} href={s.href} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[13px] hover:border-accent hover:text-accent-text">
                  <Circle className="size-3.5 text-subtle" /> {s.title}
                </Link>
              ))}
            </Card>
          )}

          {(inbox.isError || history.isError) && <ErrorPanel error={inbox.error ?? history.error} />}

          {/* ── Şu an elimde ne var? ────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Tile
              label="Testte bekleyen"
              icon={FlaskConical}
              value={queue ? inTest.length : undefined}
              active={tab === "test"}
              onClick={() => openTab("test")}
              foot={queue && (staleCount ? <Badge tone="warning">{staleCount} tanesi {staleDays}+ gündür</Badge> : <span className="text-success">Geciken yok</span>)}
            />
            <Tile
              label="Sırada (başlanmadı)"
              icon={Inbox}
              value={queue ? fresh.length : undefined}
              active={tab === "new"}
              onClick={() => openTab("new")}
              foot={thisWeek && `Bu hafta ${thisWeek.totals.received} madde atandı`}
            />
            <Tile
              label="Beklemede"
              icon={CirclePause}
              value={queue ? paused.length : undefined}
              active={tab === "paused"}
              onClick={() => openTab("paused")}
              foot={queue && (paused.length ? `En eskisi ${paused[0]!.days} gün` : "Bekleyen yok")}
            />
            <Tile
              label="Bu hafta kapattığım"
              icon={CircleCheckBig}
              value={thisWeek?.totals.closed}
              href="/reports"
              foot={
                thisWeek &&
                lastWeek && (
                  <span className="flex flex-wrap items-center gap-x-2">
                    <strong className="font-semibold text-text">{nf.format(thisWeek.totals.effort)} SP</strong>
                    <Delta current={thisWeek.totals.closed} previous={lastWeek.totals.closed} />
                  </span>
                )
              }
            />
          </div>

          {/* ── İş kuyruğu ve dikkat gerekenler ─────────────────────────── */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div ref={queueRef} className="scroll-mt-6 lg:col-span-2">
              <QueueCard tab={tab} setTab={setTab} queue={queue} staleDays={staleDays} jiraBaseUrl={jiraBaseUrl} />
            </div>
            <ActionsCard actions={actions} loading={!queue} onTab={openTab} onHref={(href) => router.push(href)} staleDays={staleDays} />
          </div>

          {/* ── Haftalık verim ve release'ler ───────────────────────────── */}
          <div className="grid gap-6 lg:grid-cols-3">
            <WeeklyCard history={history.data} loading={history.isPending} error={history.isError ? history.error : undefined} onSelect={(w) => router.push(`/reports?week=${w}`)} />
            <ReleasesCard project={firstProject} projectName={firstProject ? saved?.projects[firstProject]?.name : undefined} releases={releases} />
          </div>
        </div>
      )}
    </>
  );
}

// ── Kutucuk ──────────────────────────────────────────────────────────────────

function Tile({
  label,
  icon: Icon,
  value,
  foot,
  href,
  onClick,
  active,
}: {
  label: string;
  icon: LucideIcon;
  value: number | undefined;
  foot?: ReactNode;
  href?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        <span className={cn("grid size-8 place-items-center rounded-lg", active ? "bg-accent text-white" : "bg-accent-soft text-accent-text")}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className="mt-1 text-[32px] leading-none font-semibold tracking-tight tabular-nums">{value === undefined ? <Skeleton className="h-8 w-12" /> : value}</p>
      <div className="mt-2.5 min-h-5 text-xs text-subtle">{foot}</div>
    </>
  );
  const cls = cn(
    "block w-full rounded-2xl border bg-surface p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop",
    active ? "border-accent ring-4 ring-accent/10" : "border-border",
  );
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls} aria-pressed={active}>
      {body}
    </button>
  );
}

/** Başlıklı kart: başlığın yanında isteğe bağlı "?" açıklaması. */
function Panel({
  icon: Icon,
  title,
  sub,
  help,
  action,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  sub?: ReactNode;
  help?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-accent-text" aria-hidden />
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {sub && <span className="truncate text-xs text-subtle">{sub}</span>}
          {help && <HelpButton title={title}>{typeof help === "string" ? <p>{help}</p> : help}</HelpButton>}
        </div>
        {action}
      </div>
      <div className="flex-1">{children}</div>
    </Card>
  );
}

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { key: T; label: ReactNode }[]; label: string }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl bg-surface-2 p-1" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] font-medium transition-colors",
            value === o.key ? "bg-surface text-text shadow-card" : "text-muted hover:text-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── İş kuyruğu ───────────────────────────────────────────────────────────────

const TABS: { key: QueueTab; label: string; empty: string }[] = [
  { key: "test", label: "Testte", empty: "Testte bekleyen madde yok" },
  { key: "new", label: "Sırada", empty: "Sırada bekleyen madde yok" },
  { key: "paused", label: "Beklemede", empty: "Beklemede madde yok" },
  { key: "progress", label: "Diğer", empty: "Geliştirme ya da analizde madde yok" },
];

function QueueCard({
  tab,
  setTab,
  queue,
  staleDays,
  jiraBaseUrl,
}: {
  tab: QueueTab;
  setTab: (t: QueueTab) => void;
  queue: QueueItem<InboxItem>[] | undefined;
  staleDays: number;
  jiraBaseUrl?: string;
}) {
  const rows = queue?.filter((i) => i.stage === tab) ?? [];
  const shown = rows.slice(0, QUEUE_LIMIT);
  const count = (t: QueueTab) => queue?.filter((i) => i.stage === t).length ?? 0;

  return (
    <Panel
      icon={ListTodo}
      title="İş kuyruğum"
      help={
        <>
          <p>Size atanmış açık maddeler, bulundukları aşamaya göre. En uzun bekleyen en üstte.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Testte:</strong> Ayarlar&apos;da &quot;testte&quot; seçilen statüler
            </li>
            <li>
              <strong>Sırada:</strong> henüz başlanmamış (New, Verified…)
            </li>
            <li>
              <strong>Beklemede:</strong> Paused statüsündekiler
            </li>
          </ul>
          <p>
            Gün, maddenin şu anki statüye girdiği andan bu yana geçen süredir. Testte {staleDays}+ gün turuncu, {staleDays * 2}+ gün kırmızı görünür; eşik Ayarlar →
            Tercihler&apos;den değişir.
          </p>
        </>
      }
      action={
        <Segmented
          label="Aşama"
          value={tab}
          onChange={setTab}
          options={TABS.map((t) => ({
            key: t.key,
            label: (
              <>
                {t.label}
                <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", tab === t.key ? "bg-accent-soft text-accent-text" : "bg-surface-3")}>{count(t.key)}</span>
              </>
            ),
          }))}
        />
      }
    >
      {!queue ? (
        <LoadingRows rows={5} />
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
          <CheckCircle2 className="size-8 text-success" />
          <p className="text-sm font-medium">{TABS.find((t) => t.key === tab)!.empty}</p>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border border-t border-border">
            {shown.map((i) => (
              <QueueRow key={i.key} item={i} staleDays={staleDays} jiraBaseUrl={jiraBaseUrl} />
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-2.5 text-xs text-subtle">
            <span>{rows.length > shown.length ? `${rows.length - shown.length} madde daha` : `${rows.length} madde`}</span>
            <Link href="/inbox" className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline">
              Gelen kutusu <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </>
      )}
    </Panel>
  );
}

const AGE_CLASS = { danger: "bg-danger-soft text-danger", warning: "bg-warning-soft text-warning", neutral: "bg-surface-3 text-muted" } as const;

function QueueRow({ item: i, staleDays, jiraBaseUrl }: { item: QueueItem<InboxItem>; staleDays: number; jiraBaseUrl?: string }) {
  const tone = ageTone(i.stage, i.days, staleDays);
  const release = i.fixVersions.map((v) => v.name).join(", ");
  return (
    <li className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2/60">
      {i.issueType?.iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={i.issueType.iconUrl} alt={i.issueType.name} title={i.issueType.name} width={16} height={16} className="shrink-0" referrerPolicy="no-referrer" />
      ) : (
        <span className="size-4 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <IssueKey value={i.key} href={jiraBaseUrl ? `${jiraBaseUrl}/browse/${i.key}` : undefined} />
          <span className="truncate text-[13px]" title={i.summary}>
            {i.summary}
          </span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-subtle">
          <span className="shrink-0">{i.status.name}</span>
          {release && (
            <span className="truncate" title={release}>
              · {release}
            </span>
          )}
          {isHighPriority(i.priority?.name) && (
            <Badge tone="danger" className="px-1.5 py-0 text-[11px]">
              {i.priority?.name}
            </Badge>
          )}
        </div>
      </div>
      <span
        className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", AGE_CLASS[tone])}
        title={`${i.days} gündür "${i.status.name}" statüsünde`}
      >
        {i.days === 0 ? "bugün" : `${i.days} gün`}
      </span>
      {i.stage === "test" && (
        <ButtonLink href={`/tests/${i.key}`} size="sm" variant="ghost" className="max-sm:hidden">
          Test et
        </ButtonLink>
      )}
    </li>
  );
}

// ── Dikkat gerekenler ────────────────────────────────────────────────────────

const SEVERITY: Record<Severity, { icon: LucideIcon; className: string; label: string }> = {
  critical: { icon: OctagonAlert, className: "bg-danger-soft text-danger", label: "Kritik" },
  warning: { icon: TriangleAlert, className: "bg-warning-soft text-warning", label: "Dikkat" },
  good: { icon: CheckCircle2, className: "bg-success-soft text-success", label: "Hazır" },
  info: { icon: Info, className: "bg-info-soft text-info", label: "Bilgi" },
};

function ActionsCard({
  actions,
  loading,
  onTab,
  onHref,
  staleDays,
}: {
  actions: Action[];
  loading: boolean;
  onTab: (t: QueueTab) => void;
  onHref: (href: string) => void;
  staleDays: number;
}) {
  return (
    <Panel
      icon={TriangleAlert}
      title="Dikkat gerekenler"
      help={
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Kritik:</strong> son 30 günde geciken release, sırada ya da testte bekleyen yüksek öncelikli madde
          </li>
          <li>
            <strong>Dikkat:</strong> {staleDays}+ gündür testte bekleyen, yaklaşan release&apos;te testi bitmemiş, bilgi talebi gönderilmemiş madde
          </li>
          <li>
            <strong>Hazır:</strong> kapatılabilecek release
          </li>
          <li>
            <strong>Bilgi:</strong> bu hafta kapanıp StoryPointTest&apos;i boş kalan (haftalık efor eksik görünür), {OLD_PAUSED_DAYS}+ gündür beklemede olan madde
          </li>
        </ul>
      }
    >
      {loading ? (
        <LoadingRows rows={4} />
      ) : actions.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
          <CheckCircle2 className="size-8 text-success" />
          <p className="text-sm font-medium">Her şey yolunda</p>
        </div>
      ) : (
        <ul className="space-y-0.5 px-3 pb-3">
          {actions.map((a) => {
            const s = SEVERITY[a.severity];
            const target = a.target;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => ("tab" in target ? onTab(target.tab) : onHref(target.href))}
                  className="group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-2"
                >
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", s.className)} title={s.label}>
                    <s.icon className="size-4" aria-label={s.label} />
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] leading-snug">{a.title}</span>
                  <span className="text-lg font-semibold tabular-nums">{a.count}</span>
                  <ChevronRight className="size-4 text-subtle transition-transform group-hover:translate-x-0.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ── Haftalık verim ───────────────────────────────────────────────────────────

type Metric = "closed" | "effort";

function WeeklyCard({
  history,
  loading,
  error,
  onSelect,
}: {
  history: WeeklyHistory | undefined;
  loading: boolean;
  error?: unknown;
  onSelect: (week: string) => void;
}) {
  const [metric, setMetric] = useState<Metric>("closed");
  const weeks = history?.weeks.slice(-CHART_WEEKS);
  const done = weeks?.filter((w) => w.week !== history?.currentWeek) ?? [];
  const avg = (f: (w: (typeof done)[number]) => number) => (done.length ? done.reduce((n, w) => n + f(w), 0) / done.length : 0);

  return (
    <Panel
      icon={TrendingUp}
      title="Haftalık verim"
      sub={`son ${CHART_WEEKS} hafta`}
      className="lg:col-span-2"
      help={
        <>
          <p>Her hafta test edip kapattığınız madde sayısı ya da bu maddelerin StoryPointTest toplamı (efor).</p>
          <p>Kapatma: maddeyi sizin geçişinizle Completed / To be Deployed gibi bir &quot;bitti&quot; statüsüne almanız. Soluk sütun içinde bulunulan haftadır.</p>
          <p>Bir sütuna tıklayınca o haftanın raporu açılır.</p>
        </>
      }
      action={
        <Segmented
          label="Ölçü"
          value={metric}
          onChange={setMetric}
          options={[
            { key: "closed", label: "Madde" },
            { key: "effort", label: "Efor (SP)" },
          ]}
        />
      }
    >
      <div className="px-5 pb-5">
        {error ? (
          <ErrorPanel error={error} />
        ) : loading || !weeks ? (
          <LoadingRows rows={4} />
        ) : (
          <>
            <ColumnChart
              ariaLabel={`Son ${weeks.length} hafta, ${metric === "closed" ? "kapatılan madde" : "efor"}`}
              onSelect={onSelect}
              columns={weeks.map((w) => ({
                key: w.week,
                label: weekShortLabel(w.week),
                value: metric === "closed" ? w.totals.closed : w.totals.effort,
                partial: w.week === history?.currentWeek,
                tooltip: (
                  <>
                    <p className="mb-1.5 text-muted">
                      Hafta {weekNumber(w.week)} · {weekLabel(w.week)}
                    </p>
                    <p>
                      <strong className="tabular-nums">{w.totals.closed}</strong> kapatılan · <strong className="tabular-nums">{nf.format(w.totals.effort)}</strong> SP
                    </p>
                    <p className="text-muted">
                      {w.totals.bugs} bug · {w.totals.returned} geri gönderilen · {w.totals.paused} beklemeye alınan
                    </p>
                  </>
                ),
              }))}
            />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted">
              <span>
                Haftalık ortalama: <strong className="text-text tabular-nums">{nf.format(avg((w) => w.totals.closed))}</strong> madde ·{" "}
                <strong className="text-text tabular-nums">{nf.format(avg((w) => w.totals.effort))}</strong> SP
              </span>
              <Link href="/reports" className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline">
                Haftalık rapor <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

// ── Release'ler ──────────────────────────────────────────────────────────────

function ReleasesCard({
  project,
  projectName,
  releases,
}: {
  project: string | undefined;
  projectName: string | undefined;
  releases: ReturnType<typeof useProjectReleases>;
}) {
  const view = releases.data ? relevantReleases(releases.data.releases) : undefined;
  return (
    <Panel
      icon={PackageOpen}
      title="Release'ler"
      sub={projectName}
      help={
        <>
          <p>Son 30 günde geciken ve yaklaşan release&apos;ler. Çubuk: tamamlanan, devam eden ve başlanmamış maddeler.</p>
          <p>30 günden eski gecikmiş release&apos;ler burada gizlenir; Jira&apos;da arşivlemek listeleri sadeleştirir.</p>
        </>
      }
      action={
        project && (
          <ButtonLink href="/releases" size="sm" variant="ghost">
            Tümü <ArrowRight className="size-3.5" />
          </ButtonLink>
        )
      }
    >
      {!project ? (
        <p className="px-5 py-6 text-sm text-muted">
          <Link href="/settings#projects" className="font-medium text-accent-text hover:underline">
            Ayarlar&apos;dan proje ekleyin
          </Link>
        </p>
      ) : releases.isPending ? (
        <LoadingRows rows={4} />
      ) : releases.isError ? (
        <div className="px-5 pb-5">
          <ErrorPanel error={releases.error} />
        </div>
      ) : !view || view.shown.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">Yaklaşan release yok.</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {view.shown.map((r) => (
            <li key={r.id}>
              <Link href={`/releases/${r.id}`} className="block px-5 py-3 transition-colors hover:bg-surface-2/60">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium">{r.name}</span>
                  <TimingBadge release={r} />
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex-1">
                    <ReleaseProgress counts={r.counts} />
                  </div>
                  <span className="shrink-0 text-xs text-subtle tabular-nums">
                    {r.counts.done}/{r.counts.total}
                  </span>
                </div>
                {(r.counts.inTest > 0 || r.readyToClose) && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {r.counts.inTest > 0 && (
                      <Badge tone={r.counts.staleInTest ? "warning" : "info"} className="text-[11px]">
                        {r.counts.inTest} testte{r.counts.staleInTest ? ` · ${r.counts.staleInTest} gecikmiş` : ""}
                      </Badge>
                    )}
                    {r.readyToClose && (
                      <Badge tone="success" dot className="text-[11px]">
                        Kapatmaya hazır
                      </Badge>
                    )}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
