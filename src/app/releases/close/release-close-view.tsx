"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BellRing,
  CheckCircle2,
  CircleSlash,
  History as HistoryIcon,
  PackageCheck,
  Rocket,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Undo2,
  XCircle,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ReleaseProgress, TimingBadge } from "@/components/release-bits";
import { EnvMissing, ErrorPanel, NoProjects } from "@/components/states";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardHeader, Checkbox, cn, EmptyState, IssueKey, LoadingRows, Notice, PageHeader, Select, Stepper } from "@/components/ui";
import { JOURNAL_STATE_LABELS, type Journal } from "@/domain/release-close/journal";
import type { ReleasePlan } from "@/domain/release-close/preflight";
import { api } from "@/lib/client/api";
import { qk, setupState, useProjectReleases, useSettings } from "@/lib/client/queries";
import { formatDate, formatDateTime } from "@/lib/format";

const SCENARIOS: Record<ReleasePlan["scenario"], { ok: boolean; title: string; detail: string }> = {
  mixed: { ok: true, title: "To be Deployed + Completed", detail: "To be Deployed olanlar Completed yapılır, release kapatılır, Teams'e bildirim gider." },
  "all-to-be-deployed": { ok: true, title: "Hepsi To be Deployed", detail: "Tüm maddeler Completed yapılır, release kapatılır, Teams'e bildirim gider." },
  "all-completed": { ok: true, title: "Hepsi Completed", detail: "Maddelere dokunulmaz; release kapatılır, Teams'e bildirim gider." },
  blocked: { ok: false, title: "Uygun değil", detail: "Önizleme görülebilir ama işlem başlatılamaz." },
};

export function ReleaseCloseView() {
  const settings = useSettings();
  const setup = setupState(settings.data);
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();

  const project = params.get("project") ?? setup.projects[0];
  const versionId = params.get("version") ?? undefined;
  const navigate = (p: string | undefined, v?: string) => {
    const sp = new URLSearchParams();
    if (p) sp.set("project", p);
    if (v) sp.set("version", v);
    router.replace(`/releases/close?${sp.toString()}`);
  };

  const journals = useQuery({ queryKey: qk.journals, queryFn: () => api<{ journals: Journal[]; running: boolean }>("/api/release-close/journals"), enabled: setup.envOk });
  // Bu sekmede ya da sunucuda şu an çalışan bir kapatma "yarıda kalmış" sayılmaz.
  const liveRun = journals.data?.running === true;
  const active = liveRun
    ? []
    : (journals.data?.journals.filter((j) => j.state === "running" || j.state === "rolling_back" || (j.state === "rollback_failed" && !j.acknowledgedAt)) ?? []);
  const releases = useProjectReleases(setup.envOk && project && setup.projects.includes(project) ? project : undefined);

  const plan = useQuery({
    queryKey: ["release-plan", versionId],
    queryFn: () => api<ReleasePlan>("/api/release-close/plan", { method: "POST", json: { versionId } }),
    enabled: Boolean(versionId) && setup.envOk,
    staleTime: 0,
    gcTime: 0,
  });

  const [confirmed, setConfirmed] = useState(false);
  const [teamsTargetId, setTeamsTargetId] = useState("");
  const [result, setResult] = useState<Journal | null>(null);

  const execute = useMutation({
    mutationFn: () =>
      api<{ journal: Journal }>("/api/release-close/execute", {
        method: "POST",
        json: { versionId, fingerprint: plan.data!.fingerprint, teamsTargetId: teamsTargetId || null, confirm: true },
      }),
    onSuccess: ({ journal }) => {
      setResult(journal);
      queryClient.invalidateQueries({ queryKey: qk.journals });
      queryClient.invalidateQueries({ queryKey: ["releases"] });
      if (versionId) queryClient.invalidateQueries({ queryKey: qk.release(versionId) });
    },
    onError: (e) => {
      toast({ tone: "error", title: "Release kapatılamadı", description: e.message });
      plan.refetch();
      setConfirmed(false);
    },
  });

  const acknowledge = useMutation({
    mutationFn: (runId: string) => api<{ journal: Journal }>(`/api/release-close/journals/${runId}/acknowledge`, { method: "POST", json: { confirm: true } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.journals }),
    onError: (e) => toast({ tone: "error", title: "Kayıt kapatılamadı", description: e.message }),
  });

  const rollback = useMutation({
    mutationFn: (runId: string) => api<{ journal: Journal }>(`/api/release-close/journals/${runId}/rollback`, { method: "POST", json: { confirm: true } }),
    onSuccess: ({ journal }) => {
      queryClient.invalidateQueries({ queryKey: qk.journals });
      toast({ tone: journal.state === "rolled_back" ? "success" : "warning", title: JOURNAL_STATE_LABELS[journal.state] });
    },
    onError: (e) => toast({ tone: "error", title: "Geri alınamadı", description: e.message }),
  });

  if (settings.data && !setup.envOk) return <><Header /><EnvMissing issues={settings.data.env.ok ? undefined : settings.data.env.issues} /></>;
  if (setup.envOk && setup.projects.length === 0) return <><Header /><NoProjects what="Release kapatma" /></>;

  const teamsTargets = settings.data?.settings?.teams.targets ?? [];
  const jiraBaseUrl = settings.data?.env.ok ? settings.data.env.jiraBaseUrl : undefined;
  const stepIndex = result ? 3 : versionId ? (confirmed ? 2 : 1) : 0;

  return (
    <>
      <Header />

      {active.map((j) =>
        j.state === "rollback_failed" ? (
          <div key={j.runId} className="mb-6">
            <Notice tone="danger" title={`Geri alması eksik kalan kapatma: ${j.versionName}`} icon={ShieldAlert}>
              <p>Bazı adımlar geri alınamadı. Tekrar deneyebilir ya da Jira&apos;yı elle düzelttiyseniz kaydı kapatabilirsiniz.</p>
              <ul className="mt-2 list-inside list-disc text-[13px]">
                {j.steps
                  .filter((s) => s.state === "rollback_failed")
                  .map((s, i) => (
                    <li key={i}>
                      {s.issueKey ?? "Release"}: {s.error}
                    </li>
                  ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="danger" size="sm" loading={rollback.isPending} onClick={() => rollback.mutate(j.runId)}>
                  <Undo2 className="size-4" /> Tekrar geri al
                </Button>
                <Button size="sm" loading={acknowledge.isPending} onClick={() => acknowledge.mutate(j.runId)}>
                  Elle düzelttim, kaydı kapat
                </Button>
              </div>
            </Notice>
          </div>
        ) : (
          <div key={j.runId} className="mb-6">
            <Notice tone="danger" title={`Yarıda kalmış bir release kapatma var: ${j.versionName}`} icon={ShieldAlert}>
              <p>
                {formatDateTime(j.startedAt)} tarihinde başlayan işlem tamamlanmadı (uygulama kapanmış ya da bağlantı kopmuş olabilir). Tutarlılık için yapılan adımlar geri alınmalı.
              </p>
              <Button variant="danger" size="sm" className="mt-3" loading={rollback.isPending} onClick={() => rollback.mutate(j.runId)}>
                <Undo2 className="size-4" /> Yapılanları geri al
              </Button>
            </Notice>
          </div>
        ),
      )}

      <Card className="mb-6 p-5">
        <Stepper steps={["Release seç", "Önizle", "Onayla", "Sonuç"]} current={stepIndex} />
      </Card>

      {result ? (
        <ResultView journal={result} teamsTargets={teamsTargets} onDone={() => { setResult(null); navigate(project); }} />
      ) : !versionId ? (
        <div className="space-y-4">
          {setup.projects.length > 1 && (
            <div className="flex flex-wrap gap-1 rounded-xl bg-surface-2 p-1">
              {setup.projects.map((k) => (
                <button key={k} onClick={() => navigate(k)} className={cn("rounded-lg px-3 py-1.5 font-mono text-[13px] font-medium", project === k ? "bg-surface shadow-card" : "text-muted")}>
                  {k}
                </button>
              ))}
            </div>
          )}
          {releases.isError && <ErrorPanel error={releases.error} />}
          {releases.isPending ? (
            <Card><LoadingRows rows={3} /></Card>
          ) : releases.data?.releases.length === 0 ? (
            <Card><EmptyState icon={PackageCheck} title="Kapatılacak release yok" description="Bu projede canlıya çıkmamış versiyon bulunmuyor." /></Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {releases.data?.releases.map((r) => (
                <button
                  key={r.id}
                  onClick={() => navigate(project, r.id)}
                  className="rounded-2xl border border-border bg-surface p-5 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-pop"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold">{r.name}</h3>
                    <TimingBadge release={r} />
                  </div>
                  <p className="mt-3 text-sm text-muted">
                    {r.counts.total} madde · {r.counts.toBeDeployed} To be Deployed · {r.counts.completed} Completed
                  </p>
                  <ReleaseProgress counts={r.counts} />
                  <div className="mt-3">
                    {r.readyToClose ? (
                      <Badge tone="success" dot>Kapatmaya hazır</Badge>
                    ) : r.readyToClose === false ? (
                      <Badge tone="warning" dot>{r.counts.total === 0 ? "Madde yok" : `${r.counts.other} madde hazır değil`}</Badge>
                    ) : (
                      <Badge>Statü eşlemesi eksik</Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : plan.isPending ? (
        <Card><LoadingRows rows={5} /></Card>
      ) : plan.isError ? (
        <ErrorPanel error={plan.error} action={<Button size="sm" onClick={() => navigate(project)}>Geri dön</Button>} />
      ) : (
        <PreviewView
          plan={plan.data}
          jiraBaseUrl={jiraBaseUrl}
          teamsTargets={teamsTargets}
          teamsTargetId={teamsTargetId}
          setTeamsTargetId={setTeamsTargetId}
          confirmed={confirmed}
          setConfirmed={setConfirmed}
          blockedByActive={active.length > 0}
          executing={execute.isPending}
          onExecute={() => execute.mutate()}
          onBack={() => { setConfirmed(false); navigate(project); }}
          onRefresh={() => { setConfirmed(false); plan.refetch(); }}
          refreshing={plan.isFetching}
        />
      )}

      <JournalHistory journals={journals.data?.journals ?? []} />
    </>
  );
}

function Header() {
  return (
    <PageHeader
      eyebrow="Release"
      title="Release kapat"
      description="Canlı çıkıştan sonra release'i tek seferde kapatın. Önce ne yapılacağını görürsünüz; beklenmeyen bir durum varsa hiçbir şey yapılmaz."
    />
  );
}

function PreviewView(props: {
  plan: ReleasePlan;
  jiraBaseUrl?: string;
  teamsTargets: { id: string; name: string }[];
  teamsTargetId: string;
  setTeamsTargetId: (v: string) => void;
  confirmed: boolean;
  setConfirmed: (v: boolean) => void;
  blockedByActive: boolean;
  executing: boolean;
  onExecute: () => void;
  onBack: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { plan } = props;
  const scenario = SCENARIOS[plan.scenario];
  const toTransition = plan.issues.filter((i) => i.action === "transition");
  const untouched = plan.issues.filter((i) => i.action === "none");
  const blocked = plan.issues.filter((i) => i.action === "blocked");
  const canRun = plan.canExecute && !props.blockedByActive;

  return (
    <div className="space-y-6">
      <div className={cn("animate-in overflow-hidden rounded-3xl border shadow-card", scenario.ok ? "border-success/30" : "border-danger/30")}>
        <div className={cn("flex flex-wrap items-center gap-4 px-6 py-5", scenario.ok ? "bg-success-soft" : "bg-danger-soft")}>
          <span className={cn("grid size-12 place-items-center rounded-2xl text-white", scenario.ok ? "bg-success" : "bg-danger")}>
            {scenario.ok ? <ShieldCheck className="size-6" /> : <CircleSlash className="size-6" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn("text-xs font-semibold uppercase tracking-wide", scenario.ok ? "text-success" : "text-danger")}>{scenario.ok ? "Uygun" : "Uygun değil"}</p>
            <h2 className="text-xl font-semibold">
              {plan.version.name} <span className="font-normal text-muted">· {plan.project.name}</span>
            </h2>
            <p className="text-sm text-text/80">
              <strong>{scenario.title}:</strong> {scenario.detail}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={props.onRefresh} loading={props.refreshing}>
            <RotateCcw className="size-4" /> Yenile
          </Button>
        </div>
        <div className="grid divide-y divide-border bg-surface sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Metric label="Completed yapılacak" value={toTransition.length} tone="text-info" />
          <Metric label="Dokunulmayacak (Completed)" value={untouched.length} tone="text-success" />
          <Metric label="Engelleyen" value={blocked.length} tone={blocked.length ? "text-danger" : "text-subtle"} />
        </div>
      </div>

      {plan.blockers.length > 0 && (
        <Notice tone="danger" title="İşlem başlatılamaz" icon={XCircle}>
          <ul className="list-inside list-disc">
            {plan.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Notice>
      )}
      {props.blockedByActive && <Notice tone="danger" title="Önce yarıda kalmış işlemi geri alın." />}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title={`Release içeriği (${plan.issues.length})`} description="Her maddenin ne olacağı" />
          {plan.issues.length === 0 ? (
            <p className="p-5 text-sm text-muted">Pakette hiç madde yok.</p>
          ) : (
            <ul className="max-h-130 divide-y divide-border overflow-y-auto">
              {[...blocked, ...toTransition, ...untouched].map((i) => (
                <li key={i.key} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <IssueKey value={i.key} href={props.jiraBaseUrl ? `${props.jiraBaseUrl}/browse/${i.key}` : undefined} />
                    <p className="truncate text-[13px]">{i.summary}</p>
                    {i.problem && <p className="text-xs text-danger">{i.problem}</p>}
                  </div>
                  <span className="text-xs text-muted">{i.status.name}</span>
                  {i.action === "transition" && <Badge tone="info">→ {plan.statuses?.completed.name ?? "Completed"}</Badge>}
                  {i.action === "none" && <Badge tone="success">Dokunulmaz</Badge>}
                  {i.action === "blocked" && <Badge tone="danger">Engel</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="h-fit">
          <CardHeader icon={Rocket} title="Onay" />
          <div className="space-y-4 p-5 text-sm">
            <dl className="space-y-2">
              <Row label="Release">{plan.version.name}</Row>
              <Row label="Çıkış tarihi">{formatDate(plan.releaseDate)} (bugün)</Row>
              {plan.version.releaseDate && <Row label="Planlanan">{formatDate(plan.version.releaseDate)}</Row>}
            </dl>
            <ul className="space-y-1.5 rounded-xl bg-surface-2 p-3 text-[13px]">
              {toTransition.length > 0 && <li>• {toTransition.length} madde {plan.statuses?.completed.name} yapılır ve her birine yorum eklenir</li>}
              <li>• Release &quot;released&quot; olarak işaretlenir</li>
              <li>• Seçtiyseniz Teams&apos;e bildirim gider</li>
            </ul>
            {plan.warnings.map((w) => (
              <p key={w} className="flex gap-2 text-xs text-muted">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" /> {w}
              </p>
            ))}
            <label className="block space-y-1.5">
              <span className="flex items-center gap-1.5 text-[13px] font-medium">
                <BellRing className="size-3.5" /> Teams bildirimi
              </span>
              <Select value={props.teamsTargetId} onChange={(e) => props.setTeamsTargetId(e.target.value)} disabled={!props.teamsTargets.length}>
                <option value="">{props.teamsTargets.length ? "Bildirim gönderme" : "Hedef yok (Ayarlar'dan ekleyin)"}</option>
                {props.teamsTargets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </label>
            <Checkbox
              label="Ne yapılacağını gördüm, onaylıyorum"
              description="Önizlemeden sonra Jira'da bir şey değişirse işlem başlamaz."
              checked={props.confirmed}
              disabled={!canRun}
              onChange={(e) => props.setConfirmed(e.target.checked)}
            />
            <div className="flex gap-2">
              <Button variant="ghost" onClick={props.onBack}>
                <ArrowLeft className="size-4" /> Geri
              </Button>
              <Button variant="primary" className="flex-1" disabled={!canRun || !props.confirmed} loading={props.executing} onClick={props.onExecute}>
                <Rocket className="size-4" /> Release&apos;i kapat
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="px-6 py-4">
      <p className={cn("font-[family-name:var(--font-display)] text-3xl font-semibold", tone)}>{value}</p>
      <p className="text-[13px] text-muted">{label}</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function ResultView({ journal, teamsTargets, onDone }: { journal: Journal; teamsTargets: { id: string; name: string }[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [current, setCurrent] = useState(journal);
  const [target, setTarget] = useState(teamsTargets[0]?.id ?? "");
  const notify = useMutation({
    mutationFn: () => api<{ journal: Journal }>(`/api/release-close/journals/${current.runId}/notify`, { method: "POST", json: { targetId: target, confirm: true } }),
    onSuccess: ({ journal: j }) => {
      setCurrent(j);
      queryClient.invalidateQueries({ queryKey: qk.journals });
      const last = j.notifications.at(-1);
      toast({ tone: last?.ok ? "success" : "error", title: last?.ok ? "Teams'e bildirildi" : "Bildirim gönderilemedi", description: last?.error });
    },
    onError: (e) => toast({ tone: "error", title: "Bildirim gönderilemedi", description: e.message }),
  });
  const ok = current.state === "committed";
  const transitioned = current.issues.filter((i) => i.action === "transition");
  const lastNotification = current.notifications.at(-1);

  return (
    <Card className="mx-auto max-w-3xl overflow-hidden">
      <div className={cn("px-6 py-7 text-white", ok ? "bg-success" : current.state === "rolled_back" ? "bg-warning" : "bg-danger")}>
        <div className="flex items-center gap-4">
          {ok ? <CheckCircle2 className="size-9" /> : current.state === "rolled_back" ? <Undo2 className="size-9" /> : <XCircle className="size-9" />}
          <div>
            <h2 className="text-2xl font-semibold">{ok ? `${current.versionName} kapatıldı 🚀` : JOURNAL_STATE_LABELS[current.state]}</h2>
            <p className="text-sm text-white/90">
              {ok
                ? `${transitioned.length} madde Completed yapıldı, release ${formatDate(current.releaseDate)} tarihiyle kapatıldı.`
                : current.state === "rolled_back"
                  ? "Bir adım başarısız olduğu için yapılan tüm değişiklikler geri alındı. Jira ilk haline döndü."
                  : "Bazı adımlar geri alınamadı. Aşağıdaki maddeleri Jira'da elle kontrol edin."}
            </p>
          </div>
        </div>
      </div>
      {current.error && !ok && (
        <div className="border-b border-border px-6 py-3 text-sm">
          <span className="text-muted">Neden: </span>
          {current.error}
        </div>
      )}
      <ul className="max-h-80 divide-y divide-border overflow-y-auto">
        {current.steps.map((s, i) => (
          <li key={i} className="flex items-center gap-3 px-6 py-2.5 text-[13px]">
            <StepIcon state={s.state} />
            <span className="w-24 shrink-0 font-mono text-xs">{s.issueKey ?? "Release"}</span>
            <span className="flex-1">{s.kind === "transition" ? "Statü → Completed" : s.kind === "comment" ? "Yorum" : "Release kapatma"}</span>
            <span className="text-xs text-muted">{stepLabel(s.state)}</span>
            {s.error && s.state !== "done" && <span className="max-w-60 truncate text-xs text-danger" title={s.error}>{s.error}</span>}
          </li>
        ))}
      </ul>
      {ok && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border bg-surface-2 px-6 py-4">
          <BellRing className="size-4 text-info" />
          {lastNotification ? (
            <span className={cn("text-sm", lastNotification.ok ? "text-success" : "text-danger")}>
              {lastNotification.ok ? `Teams: ${lastNotification.targetName} kanalına bildirildi` : `Teams bildirimi başarısız: ${lastNotification.error}`}
            </span>
          ) : (
            <span className="text-sm text-muted">Teams bildirimi gönderilmedi.</span>
          )}
          {teamsTargets.length > 0 && (!lastNotification || !lastNotification.ok) && (
            <div className="ml-auto flex items-center gap-2">
              <Select className="h-8 w-48" value={target} onChange={(e) => setTarget(e.target.value)}>
                {teamsTargets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
              <Button size="sm" loading={notify.isPending} onClick={() => notify.mutate()} disabled={!target}>
                Gönder
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="flex justify-end border-t border-border p-4">
        <Button variant="primary" onClick={onDone}>
          Tamam
        </Button>
      </div>
    </Card>
  );
}

function stepLabel(state: Journal["steps"][number]["state"]) {
  return {
    pending: "Bekliyor",
    done: "Yapıldı",
    unknown: "Belirsiz",
    failed: "Başarısız",
    rolled_back: "Geri alındı",
    rollback_failed: "Geri alınamadı",
    skipped: "Atlandı",
  }[state];
}

function StepIcon({ state }: { state: Journal["steps"][number]["state"] }) {
  if (state === "done") return <CheckCircle2 className="size-4 shrink-0 text-success" />;
  if (state === "rolled_back") return <Undo2 className="size-4 shrink-0 text-warning" />;
  if (state === "failed" || state === "rollback_failed") return <XCircle className="size-4 shrink-0 text-danger" />;
  return <TriangleAlert className="size-4 shrink-0 text-subtle" />;
}

function JournalHistory({ journals }: { journals: Journal[] }) {
  const done = journals.filter((j) => j.state !== "running" && j.state !== "rolling_back");
  if (!done.length) return null;
  return (
    <Card className="mt-8">
      <CardHeader icon={HistoryIcon} title="Geçmiş" description="Bu bilgisayardan yapılan release kapatmaları" />
      <ul className="divide-y divide-border">
        {done.map((j) => (
          <li key={j.runId} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <span className="font-mono text-xs text-muted">{j.projectKey}</span>
            <span className="font-medium">{j.versionName}</span>
            <Badge tone={j.state === "committed" ? "success" : j.state === "rolled_back" ? "warning" : "danger"} dot>
              {JOURNAL_STATE_LABELS[j.state]}
            </Badge>
            <span className="ml-auto text-xs text-subtle">{formatDateTime(j.startedAt)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
