"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Bug,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  CircleCheckBig,
  CirclePause,
  Copy,
  FileChartColumn,
  History,
  NotebookPen,
  Play,
  Save,
  Send,
  Undo2,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ColumnChart, Delta } from "@/components/charts";
import { HelpButton, Modal } from "@/components/modal";
import { RecipientPicker, validContactIds } from "@/components/recipient-picker";
import { EnvMissing, ErrorPanel } from "@/components/states";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, cn, Field, IssueKey, LoadingRows, PageHeader, Select, Skeleton, StatusPill, Textarea } from "@/components/ui";
import { teamsTargetLabel } from "@/domain/settings/schema";
import { LIST_KEYS, type ListKey, type ReportItem, type WeekReport, type WeekTotals } from "@/domain/weekly/activity";
import { LIST_LABELS, weeklyMarkdown } from "@/domain/weekly/markdown";
import { MAX_NOTE_LENGTH, type SavedWeek } from "@/domain/weekly/store";
import { isWeekId, shiftWeek, weekIdOf, weekLabel, weekNumber } from "@/domain/weekly/week";
import { api } from "@/lib/client/api";
import { qk, useSettings, useWeeklyHistory, useWeeklyReport } from "@/lib/client/queries";
import { formatDateTime } from "@/lib/format";

type Me = { connected: true; displayName: string } | { connected: false };

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
const dayTime = new Intl.DateTimeFormat("tr-TR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const weekday = new Intl.DateTimeFormat("tr-TR", { weekday: "short" });

const LIST_ICONS: Record<ListKey, LucideIcon> = {
  closed: CircleCheckBig,
  bugs: Bug,
  returned: Undo2,
  paused: CirclePause,
  started: Play,
  received: UserPlus,
};

export function ReportsView() {
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [currentWeek, setCurrentWeek] = useState<string | null>(null);
  useEffect(() => setCurrentWeek(weekIdOf(new Date())), []);

  const raw = params.get("week")?.toUpperCase();
  const week = raw && isWeekId(raw) ? raw : (currentWeek ?? undefined);
  const settings = useSettings();
  const envOk = settings.data?.env.ok === true;
  const jiraBaseUrl = settings.data?.env.ok ? settings.data.env.jiraBaseUrl : undefined;
  const report = useWeeklyReport(week, envOk);
  const history = useWeeklyHistory(envOk);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me"), staleTime: 5 * 60_000, enabled: envOk });

  // Not taslakları hafta başına tutulur; hafta değiştirince yazılan kaybolmaz.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [teamsOpen, setTeamsOpen] = useState(false);
  const data = report.data && report.data.report.week === week ? report.data : undefined;
  const saved = data?.saved;
  const note = week ? (drafts[week] ?? saved?.note ?? "") : "";
  const dirty = week !== undefined && drafts[week] !== undefined && drafts[week] !== (saved?.note ?? "");

  const go = (w: string) => router.replace(`/reports?week=${w}`, { scroll: false });
  /**
   * Kayıt, gönderildiği haftaya işlenir (bu arada hafta değişmiş olabilir). Taslak yalnızca kaydedilen notla
   * aynıysa silinir; kayıt sürerken yazılanlar kaybolmaz.
   */
  const onSaved = (w: string, sentNote: string, s: SavedWeek) => {
    queryClient.setQueryData(qk.weekly(w), (old: typeof report.data) => (old ? { ...old, saved: s } : old));
    void queryClient.invalidateQueries({ queryKey: qk.weeklyHistory });
    setDrafts((d) => {
      if (d[w] !== sentNote) return d;
      const { [w]: _, ...rest } = d;
      return rest;
    });
  };

  const save = useMutation({
    mutationFn: (v: { week: string; note: string }) => api<{ saved: SavedWeek }>(`/api/reports/weekly/${v.week}`, { method: "PUT", json: { note: v.note } }),
    onSuccess: ({ saved: s }, v) => {
      onSaved(v.week, v.note, s);
      toast({ tone: "success", title: "Rapor kaydedildi" });
    },
    onError: (e) => toast({ tone: "error", title: "Kaydedilemedi", description: e instanceof Error ? e.message : undefined }),
  });

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(weeklyMarkdown(data.report, { jiraBaseUrl, note, person: me.data?.connected ? me.data.displayName : undefined }));
      toast({ tone: "success", title: "Rapor panoya kopyalandı", description: "E-posta, Teams ya da wiki'ye yapıştırabilirsiniz." });
    } catch {
      toast({ tone: "error", title: "Panoya erişilemedi" });
    }
  };

  const isCurrent = week !== undefined && week === currentWeek;
  // Hafta kimlikleri ("2026-W41") metin olarak da doğru sıralanır.
  const atLatest = week !== undefined && currentWeek !== null && week >= currentWeek;

  return (
    <>
      <PageHeader
        eyebrow="Günlük iş"
        title="Haftalık Rapor"
        action={
          envOk &&
          data && (
            <>
              <Button onClick={copy}>
                <Copy className="size-4" /> Kopyala
              </Button>
              <Button onClick={() => setTeamsOpen(true)} disabled={!settings.data?.settings?.teams.targets.length} title={settings.data?.settings?.teams.targets.length ? undefined : "Ayarlar'dan Teams hedefi ekleyin"}>
                <Send className="size-4" /> Teams&apos;e gönder
              </Button>
              <Button variant="primary" onClick={() => week && save.mutate({ week, note })} loading={save.isPending}>
                {!save.isPending && <Save className="size-4" />} Kaydet
              </Button>
            </>
          )
        }
      />

      {settings.data && !envOk && <EnvMissing issues={settings.data.env.ok ? undefined : settings.data.env.issues} />}

      {envOk && week && (
        <div className="space-y-6">
          {/* ── Hafta seçimi ─────────────────────────────────────────────── */}
          <Card className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <Button variant="ghost" size="sm" onClick={() => go(shiftWeek(week, -1))} aria-label="Önceki hafta">
              <ChevronLeft className="size-4" />
            </Button>
            <div className="min-w-0 text-center">
              <p className="text-[15px] font-semibold">Hafta {weekNumber(week)}</p>
              <p className="text-xs text-muted">{weekLabel(week)}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => go(shiftWeek(week, 1))} disabled={atLatest} aria-label="Sonraki hafta">
              <ChevronRight className="size-4" />
            </Button>
            {!isCurrent && currentWeek && (
              <Button size="sm" onClick={() => go(currentWeek)}>
                Bu hafta
              </Button>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2 pr-2">
              {report.isFetching && <span className="text-xs text-subtle">Jira&apos;dan okunuyor…</span>}
              {isCurrent && <Badge tone="info">Devam ediyor</Badge>}
              <SavedBadge saved={saved} dirty={dirty} />
            </div>
          </Card>

          {report.isError && <ErrorPanel error={report.error} />}

          {/* ── Haftanın sayıları ────────────────────────────────────────── */}
          <Totals totals={data?.report.totals} previous={data?.previous} />

          <div className="grid gap-6 lg:grid-cols-3">
            <ListsCard report={data?.report} jiraBaseUrl={jiraBaseUrl} className="lg:col-span-2" />
            <div className="space-y-6">
              <DaysCard report={data?.report} />
              <Card>
                <div className="flex items-center gap-2 px-5 pt-4 pb-3">
                  <NotebookPen className="size-4 text-accent-text" aria-hidden />
                  <h2 className="text-[15px] font-semibold">Notlar</h2>
                  <HelpButton title="Notlar">
                    <p>Jira&apos;da görünmeyen işler: toplantılar, ortam sorunları, destek, öğrendikleriniz. Kopyalanan rapora ve Teams kartına eklenir.</p>
                    <p>Notlar yalnızca bu bilgisayarda saklanır, Jira&apos;ya yazılmaz.</p>
                  </HelpButton>
                </div>
                <div className="px-5 pb-5">
                  <Textarea
                    aria-label="Haftanın notları"
                    rows={6}
                    maxLength={MAX_NOTE_LENGTH}
                    value={note}
                    onChange={(e) => setDrafts((d) => ({ ...d, [week]: e.target.value }))}
                    placeholder="Bu hafta Jira dışında…"
                  />
                  <div className="mt-2 flex items-center justify-between text-xs text-subtle">
                    <span>{dirty ? "Kaydedilmemiş değişiklik" : saved ? `Kaydedildi · ${formatDateTime(saved.savedAt)}` : ""}</span>
                    <span className="tabular-nums">
                      {note.length}/{MAX_NOTE_LENGTH}
                    </span>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          {history.isError ? (
            <ErrorPanel error={history.error} />
          ) : (
            <HistoryCard history={history.data?.weeks} loading={history.isPending} selected={week} onSelect={go} />
          )}
        </div>
      )}

      {data && week && (
        <TeamsModal
          open={teamsOpen}
          onClose={() => setTeamsOpen(false)}
          week={week}
          note={note}
          totals={data.report.totals}
          onSent={(w, sentNote, s) => {
            onSaved(w, sentNote, s);
            setTeamsOpen(false);
            toast({ tone: "success", title: "Rapor Teams'e gönderildi", description: s.sentTo });
          }}
        />
      )}
    </>
  );
}

function SavedBadge({ saved, dirty }: { saved?: SavedWeek; dirty: boolean }) {
  if (dirty) return <Badge tone="warning">Kaydedilmedi</Badge>;
  if (saved?.sentAt)
    return (
      <Badge tone="success" dot>
        Teams&apos;e gönderildi · {formatDateTime(saved.sentAt)}
      </Badge>
    );
  if (saved)
    return (
      <Badge tone="success" dot>
        Kaydedildi · {formatDateTime(saved.savedAt)}
      </Badge>
    );
  return <Badge>Kaydedilmedi</Badge>;
}

// ── Sayılar ──────────────────────────────────────────────────────────────────

function Totals({ totals, previous }: { totals?: WeekTotals; previous?: WeekTotals }) {
  const tiles: { key: keyof WeekTotals; label: string; icon: LucideIcon; format?: (n: number) => string; upIsGood?: boolean; neutral?: boolean; foot?: (t: WeekTotals) => ReactNode }[] = [
    { key: "closed", label: "Kapattığım", icon: CircleCheckBig },
    {
      key: "effort",
      label: "Efor (SP)",
      icon: Activity,
      format: (n) => nf.format(n),
      foot: (t) => (t.missingEffort ? <span className="text-warning">{t.missingEffort} maddede efor girilmemiş</span> : null),
    },
    { key: "bugs", label: "Bulduğum bug", icon: Bug, neutral: true },
    { key: "returned", label: "Geri gönderdiğim", icon: Undo2, neutral: true },
    { key: "paused", label: "Beklemeye aldığım", icon: CirclePause, neutral: true },
    { key: "received", label: "Bana gelen", icon: UserPlus, neutral: true },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((t) => (
        <div key={t.key} className="rounded-2xl border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-medium text-muted">{t.label}</p>
            <t.icon className="size-4 shrink-0 text-subtle" aria-hidden />
          </div>
          <p className="mt-2 text-[28px] leading-none font-semibold tracking-tight tabular-nums">
            {totals ? (t.format ?? String)(totals[t.key]) : <Skeleton className="h-7 w-10" />}
          </p>
          <div className="mt-2 min-h-5 text-xs">
            {totals && previous && (t.foot?.(totals) ?? <Delta current={totals[t.key]} previous={previous[t.key]} upIsGood={t.upIsGood ?? true} neutral={t.neutral} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Listeler ─────────────────────────────────────────────────────────────────

function ListsCard({ report, jiraBaseUrl, className }: { report?: WeekReport; jiraBaseUrl?: string; className?: string }) {
  const [tab, setTab] = useState<ListKey>("closed");
  const items = report?.lists[tab] ?? [];
  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="flex flex-wrap items-center gap-2 px-5 pt-4 pb-3">
        <FileChartColumn className="size-4 text-accent-text" aria-hidden />
        <h2 className="text-[15px] font-semibold">Ne yaptım?</h2>
        <HelpButton title="Ne yaptım?">
          <p>Listeler, o hafta Jira&apos;da sizin yaptığınız statü geçişlerinden çıkarılır:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Kapattıklarım:</strong> &quot;bitti&quot; kategorisine aldığınız maddeler (Completed, To be Deployed…). Release kapatırken To be Deployed → Completed tekrar sayılmaz; iptal sayılmaz.
            </li>
            <li>
              <strong>Bulduğum buglar:</strong> o hafta açtığınız Bug&apos;lar
            </li>
            <li>
              <strong>Geri gönderdiklerim:</strong> testten geliştirmeye döndürdükleriniz (Test → Coding)
            </li>
            <li>
              <strong>Beklemeye aldıklarım:</strong> Paused&apos;a aldıklarınız
            </li>
            <li>
              <strong>Başladıklarım:</strong> teste aldıklarınız ya da başladığınız işler
            </li>
            <li>
              <strong>Bana gelenler:</strong> o hafta size atanan maddeler
            </li>
          </ul>
          <p>Efor, kapanan maddelerin StoryPointTest alanından gelir (Jira&apos;daki güncel değer).</p>
        </HelpButton>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-border px-4" role="group" aria-label="Liste">
        {LIST_KEYS.map((k) => {
          const Icon = LIST_ICONS[k];
          const n = report?.lists[k].length;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={tab === k}
              onClick={() => setTab(k)}
              className={cn(
                "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-[13px] font-medium transition-colors",
                tab === k ? "border-accent text-text" : "border-transparent text-muted hover:text-text",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {LIST_LABELS[k]}
              {n !== undefined && <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", tab === k ? "bg-accent-soft text-accent-text" : "bg-surface-3")}>{n}</span>}
            </button>
          );
        })}
      </div>
      {!report ? (
        <LoadingRows rows={5} />
      ) : items.length === 0 ? (
        <p className="px-5 py-14 text-center text-sm text-muted">Bu hafta bu listede madde yok.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-subtle">
                <th className="px-5 py-2 text-left font-medium">Madde</th>
                <th className="px-3 py-2 text-left font-medium">Şu an</th>
                {tab === "closed" && <th className="px-3 py-2 text-right font-medium">SP</th>}
                <th className="px-5 py-2 text-right font-medium">Tarih</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((i) => (
                <ItemRow key={i.key} item={i} jiraBaseUrl={jiraBaseUrl} showEffort={tab === "closed"} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ItemRow({ item: i, jiraBaseUrl, showEffort }: { item: ReportItem; jiraBaseUrl?: string; showEffort: boolean }) {
  return (
    <tr className="align-top transition-colors hover:bg-surface-2/60">
      <td className="max-w-0 px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {i.type?.iconUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={i.type.iconUrl} alt={i.type.name} title={i.type.name} width={14} height={14} className="shrink-0" referrerPolicy="no-referrer" />
          )}
          <IssueKey value={i.key} href={jiraBaseUrl ? `${jiraBaseUrl}/browse/${i.key}` : undefined} />
          <span className="truncate text-[13px]" title={i.summary}>
            {i.summary}
          </span>
        </div>
        {(i.release || i.transition) && (
          <p className="mt-0.5 truncate pl-[22px] text-xs text-subtle">{[i.transition, i.release].filter(Boolean).join(" · ")}</p>
        )}
      </td>
      <td className="px-3 py-2.5">
        <StatusPill name={i.status.name} category={i.status.category} />
      </td>
      {showEffort && (
        <td className="px-3 py-2.5 text-right tabular-nums">
          {i.effort !== undefined ? (
            nf.format(i.effort)
          ) : (
            <span className="text-warning" title="StoryPointTest boş">
              –
            </span>
          )}
        </td>
      )}
      <td className="px-5 py-2.5 text-right text-xs whitespace-nowrap text-subtle">{dayTime.format(Date.parse(i.at))}</td>
    </tr>
  );
}

// ── Günlük hareket ───────────────────────────────────────────────────────────

function DaysCard({ report }: { report?: WeekReport }) {
  const today = useMemo(() => new Date().toDateString(), []);
  return (
    <Card>
      <div className="flex items-center gap-2 px-5 pt-4 pb-3">
        <CalendarCheck className="size-4 text-accent-text" aria-hidden />
        <h2 className="text-[15px] font-semibold">Günlük hareket</h2>
        <HelpButton title="Günlük hareket">
          <p>Her gün Jira&apos;da yaptığınız statü geçişi sayısı. Üzerine gelince o gün kapattıklarınız da görünür.</p>
        </HelpButton>
      </div>
      <div className="px-5 pb-5">
        {!report ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <ColumnChart
            height="h-28"
            ariaLabel="Haftanın günlerine göre statü geçişleri"
            columns={report.days.map((d) => {
              const [y, m, day] = d.date.split("-").map(Number);
              const date = new Date(y!, m! - 1, day!);
              return {
                key: d.date,
                label: weekday.format(date),
                value: d.moves,
                partial: date.toDateString() === today,
                tooltip: (
                  <>
                    <p className="mb-1 text-muted">{new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" }).format(date)}</p>
                    <p>
                      <strong className="tabular-nums">{d.moves}</strong> statü geçişi · <strong className="tabular-nums">{d.closed}</strong> kapatılan
                    </p>
                  </>
                ),
              };
            })}
          />
        )}
      </div>
    </Card>
  );
}

// ── Geçmiş ───────────────────────────────────────────────────────────────────

function HistoryCard({
  history,
  loading,
  selected,
  onSelect,
}: {
  history?: { week: string; totals: WeekTotals; saved?: { savedAt: string; sentAt?: string } }[];
  loading: boolean;
  selected: string;
  onSelect: (w: string) => void;
}) {
  const rows = history ? [...history].reverse() : [];
  const max = Math.max(1, ...rows.map((r) => r.totals.closed));
  return (
    <Card>
      <div className="flex items-center gap-2 px-5 pt-4 pb-3">
        <History className="size-4 text-accent-text" aria-hidden />
        <h2 className="text-[15px] font-semibold">Rapor geçmişi</h2>
        <span className="text-xs text-subtle">son {rows.length || 12} hafta</span>
        <HelpButton title="Rapor geçmişi">
          <p>Haftalara göre özet. Bir satıra tıklayınca o haftanın raporu açılır.</p>
          <p>
            <strong>Durum</strong>, raporu kaydedip kaydetmediğinizi ya da Teams&apos;e gönderip göndermediğinizi gösterir. Sayılar Jira&apos;dan her açılışta yeniden hesaplanır.
          </p>
        </HelpButton>
      </div>
      {loading ? (
        <LoadingRows rows={5} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-y border-border text-xs text-subtle">
                <th className="px-5 py-2 text-left font-medium">Hafta</th>
                <th className="w-56 px-3 py-2 text-left font-medium">Kapattığım</th>
                <th className="px-3 py-2 text-right font-medium">Efor (SP)</th>
                <th className="px-3 py-2 text-right font-medium">Bug</th>
                <th className="px-3 py-2 text-right font-medium">Geri gönd.</th>
                <th className="px-3 py-2 text-right font-medium">Beklemeye</th>
                <th className="px-5 py-2 text-left font-medium">Durum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr
                  key={r.week}
                  onClick={() => onSelect(r.week)}
                  className={cn("cursor-pointer transition-colors hover:bg-surface-2/60", r.week === selected && "bg-accent-soft/50")}
                >
                  <td className="px-5 py-2.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(r.week);
                      }}
                      className="text-left font-medium hover:text-accent-text" aria-current={r.week === selected ? "true" : undefined}>
                      Hafta {weekNumber(r.week)}
                    </button>
                    <p className="text-xs text-subtle">{weekLabel(r.week)}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="relative h-2 flex-1 rounded-full bg-surface-3">
                        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(r.totals.closed / max) * 100}%`, background: "var(--viz-1)" }} />
                      </span>
                      <span className="w-6 text-right font-semibold tabular-nums">{r.totals.closed}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {nf.format(r.totals.effort)}
                    {r.totals.missingEffort > 0 && (
                      <span className="ml-1 text-xs text-warning" title={`${r.totals.missingEffort} maddede efor girilmemiş`}>
                        ({r.totals.missingEffort} eksik)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.totals.bugs}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.totals.returned}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.totals.paused}</td>
                  <td className="px-5 py-2.5">
                    {r.saved?.sentAt ? (
                      <Badge tone="success" dot>
                        Gönderildi
                      </Badge>
                    ) : r.saved ? (
                      <Badge tone="info" dot>
                        Kaydedildi
                      </Badge>
                    ) : (
                      <span className="text-xs text-subtle">–</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Teams ────────────────────────────────────────────────────────────────────

function TeamsModal({
  open,
  onClose,
  week,
  note,
  totals,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  week: string;
  note: string;
  totals: WeekTotals;
  onSent: (week: string, note: string, s: SavedWeek) => void;
}) {
  const settings = useSettings();
  const targets = settings.data?.settings?.teams.targets ?? [];
  const contacts = settings.data?.settings?.teams.contacts ?? [];
  const [targetId, setTargetId] = useState("");
  const [contactIds, setContactIds] = useState<string[]>([]);
  const target = targets.find((t) => t.id === targetId) ?? targets[0];
  const people = target?.kind === "people";
  const ids = validContactIds(contacts, contactIds);

  const send = useMutation({
    mutationFn: (v: { week: string; note: string }) =>
      api<{ saved: SavedWeek }>(`/api/reports/weekly/${v.week}/teams`, {
        method: "POST",
        json: { targetId: target!.id, contactIds: people ? ids : [], note: v.note, confirm: true },
      }),
    onSuccess: ({ saved }, v) => onSent(v.week, v.note, saved),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Teams'e gönder"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="primary" loading={send.isPending} disabled={!target || (people && !ids.length)} onClick={() => send.mutate({ week, note })}>
            {!send.isPending && <Send className="size-4" />} Gönder
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Hafta {weekNumber(week)} · {weekLabel(week)}: {totals.closed} kapatılan, {nf.format(totals.effort)} SP, {totals.bugs} bug{note.trim() ? " ve notlarınız" : ""}. Kart madde linklerini içerir.
        </p>
        <Field label="Hedef" htmlFor="weekly-teams-target">
          <Select id="weekly-teams-target" value={target?.id ?? ""} onChange={(e) => setTargetId(e.target.value)}>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {teamsTargetLabel(t)}
              </option>
            ))}
          </Select>
        </Field>
        {people && <RecipientPicker contacts={contacts} value={contactIds} onChange={setContactIds} />}
        {send.isError && <ErrorPanel error={send.error} />}
      </div>
    </Modal>
  );
}
