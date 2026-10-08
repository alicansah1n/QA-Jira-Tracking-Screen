"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, Check, CheckCircle2, CircleDashed, FileText, Loader2, MinusCircle, Quote, SkipForward, X, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorPanel } from "@/components/states";
import { Badge, Button, buttonClass, Card, cn, Input, LoadingRows, Notice, SegmentBar, Textarea, type Tone } from "@/components/ui";
import { PRIORITY_LABELS, TYPE_LABELS, type IssueAnalysis, type TestCase } from "@/domain/analysis/schema";
import { CASE_STATUS_LABELS, VERDICT_LABELS, type CaseStatus, type RunSummary, type TestRun } from "@/domain/testrun/schema";
import { api } from "@/lib/client/api";
import { qk } from "@/lib/client/queries";

type RunResponse = { run: TestRun | null; summary: RunSummary; analysisChanged: boolean };
type Local = Record<string, { status: CaseStatus; note: string }>;

const STATUS_OPTIONS: { value: CaseStatus; label: string; icon: typeof Check; active: string }[] = [
  { value: "passed", label: "Başarılı", icon: Check, active: "bg-success text-white border-transparent" },
  { value: "failed", label: "Başarısız", icon: X, active: "bg-danger text-white border-transparent" },
  { value: "blocked", label: "Bloke", icon: Ban, active: "bg-warning text-white border-transparent" },
  { value: "skipped", label: "Atlandı", icon: SkipForward, active: "bg-subtle text-white border-transparent" },
];

const PRIORITY_TONE: Record<TestCase["priority"], Tone> = { critical: "danger", high: "warning", medium: "info", low: "neutral" };

type Filter = "all" | "pending" | "problem";

export function TestRunner({ analysis }: { analysis: IssueAnalysis }) {
  const key = analysis.issue.key;
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: qk.run(key), queryFn: () => api<RunResponse>(`/api/runs/${key}`) });
  const [local, setLocal] = useState<Local | null>(null);
  const [environment, setEnvironment] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [finishing, setFinishing] = useState(false);
  const router = useRouter();
  const dirty = useRef<{ results: Set<string>; env: boolean }>({ results: new Set(), env: false });

  useEffect(() => {
    if (query.data && local === null) {
      const init: Local = {};
      for (const tc of analysis.testCases) {
        const r = query.data.run?.results[tc.id];
        init[tc.id] = { status: r?.status ?? "pending", note: r?.note ?? "" };
      }
      setLocal(init);
      setEnvironment(query.data.run?.environment ?? analysis.environmentNotes?.slice(0, 200) ?? "");
    }
  }, [query.data, local, analysis]);

  const save = useMutation({
    mutationFn: (body: { environment?: string; results?: Local; keepalive?: boolean }) => {
      const { keepalive, ...json } = body;
      return api<RunResponse>(`/api/runs/${key}`, { method: "PUT", json, keepalive });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(qk.run(key), data);
      // Kapatma sihirbazı her zaman güncel sonuçla açılsın.
      queryClient.invalidateQueries({ queryKey: ["close-defaults", key] });
    },
  });

  // En güncel değerler: zamanlayıcı ve sayfadan ayrılma anı aynı veriyi kaydeder.
  const latest = useRef({ local, environment });
  latest.current = { local, environment };

  // `mutateAsync` render'lar arasında sabittir; `save` nesnesi değildir (her render'da yeni).
  const saveAsync = save.mutateAsync;

  /** Bekleyen değişiklikleri hemen kaydeder; başarısız olursa değişiklikler tekrar "bekliyor" olur. */
  const flush = useCallback(
    async (keepalive = false) => {
      const cur = latest.current;
      const ids = [...dirty.current.results];
      const env = dirty.current.env;
      if (!cur.local || (!ids.length && !env)) return;
      dirty.current = { results: new Set(), env: false };
      try {
        await saveAsync({
          ...(env ? { environment: cur.environment } : {}),
          ...(ids.length ? { results: Object.fromEntries(ids.map((id) => [id, cur.local![id]!])) } : {}),
          keepalive,
        });
      } catch (error) {
        for (const id of ids) dirty.current.results.add(id);
        if (env) dirty.current.env = true;
        throw error;
      }
    },
    [saveAsync],
  );

  // Değişiklikler 500 ms sonra toplu kaydedilir.
  useEffect(() => {
    if (!local) return;
    const t = setTimeout(() => flush().catch(() => undefined), 500);
    return () => clearTimeout(t);
  }, [local, environment, flush]);

  // Sayfadan ayrılırken bekleyen değişiklik kaybolmasın.
  useEffect(() => () => void flush(true).catch(() => undefined), [flush]);

  const summary = useMemo<RunSummary | undefined>(() => {
    if (!local) return query.data?.summary;
    const counts: Record<CaseStatus, number> = { pending: 0, passed: 0, failed: 0, blocked: 0, skipped: 0 };
    for (const tc of analysis.testCases) counts[local[tc.id]?.status ?? "pending"]++;
    const total = analysis.testCases.length;
    const done = total - counts.pending;
    const verdict = counts.failed ? "failed" : counts.blocked ? "blocked" : done === 0 ? "not-started" : counts.pending ? "in-progress" : "passed";
    return { total, counts, done, progress: total ? Math.round((done / total) * 100) : 0, verdict };
  }, [local, analysis, query.data]);

  if (query.isPending) return <Card><LoadingRows rows={4} /></Card>;
  if (query.isError) return <ErrorPanel error={query.error} />;
  if (!local || !summary) return null;

  const update = (id: string, patch: Partial<Local[string]>) => {
    dirty.current.results.add(id);
    setLocal((cur) => ({ ...cur!, [id]: { ...cur![id]!, ...patch } }));
  };

  const visible = analysis.testCases.filter((tc) => {
    const s = local[tc.id]?.status ?? "pending";
    return filter === "all" || (filter === "pending" ? s === "pending" : s === "failed" || s === "blocked");
  });
  const allDone = summary.counts.pending === 0;

  return (
    <section>
      {query.data.analysisChanged && (
        <div className="mb-4">
          <Notice tone="warning" title="Analiz yenilenmiş" icon={AlertTriangle}>
            Bu çalıştırma önceki bir analize göre başlatılmış. Case&apos;leri gözden geçirin; sonuçlar case id&apos;sine göre korunur.
          </Notice>
        </div>
      )}

      <div className="sticky top-0 z-30 -mx-4 mb-5 border-b border-border bg-bg/85 px-4 py-3 backdrop-blur md:-mx-10 md:px-10">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-55 flex-1">
            <div className="mb-1.5 flex items-center justify-between text-[13px]">
              <span className="font-medium">
                {summary.done}/{summary.total} case tamamlandı
              </span>
              <span className="flex items-center gap-1.5 text-xs text-subtle">
                {save.isPending ? (
                  <>
                    <Loader2 className="size-3 animate-spin" /> Kaydediliyor
                  </>
                ) : save.isError ? (
                  <span className="text-danger">Kaydedilemedi</span>
                ) : (
                  <>
                    <Check className="size-3" /> Kaydedildi
                  </>
                )}
              </span>
            </div>
            <SegmentBar
              total={summary.total}
              segments={[
                { label: "Başarılı", value: summary.counts.passed, className: "bg-success" },
                { label: "Başarısız", value: summary.counts.failed, className: "bg-danger" },
                { label: "Bloke", value: summary.counts.blocked, className: "bg-warning" },
                { label: "Atlandı", value: summary.counts.skipped, className: "bg-subtle" },
              ]}
            />
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Counter icon={CheckCircle2} value={summary.counts.passed} className="text-success" label="Başarılı" />
            <Counter icon={XCircle} value={summary.counts.failed} className="text-danger" label="Başarısız" />
            <Counter icon={MinusCircle} value={summary.counts.blocked} className="text-warning" label="Bloke" />
            <Counter icon={CircleDashed} value={summary.counts.pending} className="text-subtle" label="Bekleyen" />
          </div>
          <div className="flex items-center gap-2">
            <a href={`/api/runs/${key}/report`} target="_blank" rel="noreferrer" className={buttonClass("secondary", "md")}>
              <FileText className="size-4" /> Rapor
            </a>
            <Button
              variant={allDone ? "primary" : "secondary"}
              loading={finishing}
              onClick={async () => {
                setFinishing(true);
                try {
                  await flush();
                  router.push(`/tests/${key}/close`);
                } catch {
                  setFinishing(false);
                }
              }}
            >
              Testi tamamla
            </Button>
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
          {(
            [
              ["all", `Tümü (${summary.total})`],
              ["pending", `Bekleyen (${summary.counts.pending})`],
              ["problem", `Sorunlu (${summary.counts.failed + summary.counts.blocked})`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={cn("rounded-lg px-3 py-1.5 text-[13px] font-medium", filter === k ? "bg-surface shadow-card" : "text-muted hover:text-text")}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex min-w-65 items-center gap-2 text-[13px]">
          <span className="text-muted">Test ortamı</span>
          <Input
            className="h-9"
            placeholder="ör. TEST2 · v4.12.0"
            value={environment}
            maxLength={200}
            onChange={(e) => {
              dirty.current.env = true;
              setEnvironment(e.target.value);
            }}
          />
        </label>
      </div>

      <div className="space-y-4">
        {visible.map((tc) => (
          <CaseCard key={tc.id} tc={tc} value={local[tc.id]!} onChange={(patch) => update(tc.id, patch)} />
        ))}
        {visible.length === 0 && <p className="rounded-2xl border border-dashed border-border-strong p-8 text-center text-sm text-muted">Bu filtrede case yok.</p>}
      </div>

      {summary.verdict !== "not-started" && (
        <p className="mt-6 text-center text-sm text-muted">
          Şu anki sonuç: <strong>{VERDICT_LABELS[summary.verdict]}</strong>
        </p>
      )}
    </section>
  );
}

function Counter({ icon: Icon, value, className, label }: { icon: typeof Check; value: number; className: string; label: string }) {
  return (
    <span className="flex items-center gap-1 rounded-lg bg-surface px-2 py-1 shadow-card" title={label}>
      <Icon className={cn("size-3.5", className)} aria-hidden />
      <span className="tabular-nums font-medium">{value}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function CaseCard({ tc, value, onChange }: { tc: TestCase; value: { status: CaseStatus; note: string }; onChange: (p: Partial<{ status: CaseStatus; note: string }>) => void }) {
  const [showNote, setShowNote] = useState(Boolean(value.note));
  const problem = value.status === "failed" || value.status === "blocked";
  const accent =
    value.status === "passed"
      ? "border-l-success"
      : value.status === "failed"
        ? "border-l-danger"
        : value.status === "blocked"
          ? "border-l-warning"
          : value.status === "skipped"
            ? "border-l-subtle"
            : "border-l-transparent";

  return (
    <Card className={cn("overflow-hidden border-l-4", accent)}>
      <div className="flex flex-wrap items-start gap-3 px-5 pt-4">
        <span className="rounded-lg bg-surface-3 px-2 py-1 font-mono text-xs font-semibold text-muted">{tc.id}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-snug">{tc.title}</h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge>{TYPE_LABELS[tc.type]}</Badge>
            <Badge tone={PRIORITY_TONE[tc.priority]}>{PRIORITY_LABELS[tc.priority]}</Badge>
            {tc.assumption && (
              <Badge tone="warning">
                <AlertTriangle className="size-3" /> Varsayım
              </Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`${tc.id} sonucu`}>
          {STATUS_OPTIONS.map((o) => {
            const active = value.status === o.value;
            return (
              <button
                key={o.value}
                role="radio"
                aria-checked={active}
                onClick={() => {
                  onChange({ status: active ? "pending" : o.value });
                  if (!active && (o.value === "failed" || o.value === "blocked")) setShowNote(true);
                }}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-all",
                  active ? o.active : "border-border bg-surface text-muted hover:border-border-strong hover:text-text",
                )}
                title={active ? "Seçimi kaldır" : CASE_STATUS_LABELS[o.value]}
              >
                <o.icon className="size-3.5" aria-hidden />
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3 px-5 py-4">
        {tc.preconditions.length > 0 && (
          <div className="text-[13px]">
            <span className="font-medium text-muted">Ön koşullar: </span>
            {tc.preconditions.join(" · ")}
          </div>
        )}
        <ol className="space-y-2">
          {tc.steps.map((s, i) => (
            <li key={i} className="grid grid-cols-[28px_1fr] gap-x-3 gap-y-1 text-sm md:grid-cols-[28px_1fr_1fr]">
              <span className="grid size-6 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text">{i + 1}</span>
              <p>{s.action}</p>
              <p className="col-start-2 text-muted md:col-start-3">
                <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-subtle">Beklenen</span>
                {s.expected}
              </p>
            </li>
          ))}
        </ol>
        {tc.testData.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {tc.testData.map((d) => (
              <span key={d.name} className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs">
                <span className="text-muted">{d.name}:</span> <span className="font-mono">{d.value}</span>
              </span>
            ))}
          </div>
        )}
        {tc.sourceRefs.length > 0 && (
          <div className="space-y-1">
            {tc.sourceRefs.map((r) => (
              <p key={r} className="flex gap-2 text-xs text-subtle">
                <Quote className="mt-0.5 size-3 shrink-0" aria-hidden /> {r}
              </p>
            ))}
          </div>
        )}
        {showNote || value.note ? (
          <Textarea
            rows={2}
            placeholder={problem ? "Ne oldu? Hata mesajı, ekran, adım…" : "Not (opsiyonel)"}
            value={value.note}
            maxLength={2000}
            onChange={(e) => onChange({ note: e.target.value })}
            className={cn(problem && !value.note && "border-warning")}
          />
        ) : (
          <button className="text-[13px] font-medium text-accent-text hover:underline" onClick={() => setShowNote(true)}>
            + Not ekle
          </button>
        )}
      </div>
    </Card>
  );
}
