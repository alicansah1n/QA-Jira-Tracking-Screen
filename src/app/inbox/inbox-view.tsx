"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Inbox, MessageSquareQuote, RefreshCw, Send, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { CopyCommand } from "@/components/copy-button";
import { IssueLine } from "@/components/issue-line";
import { EnvMissing, ErrorPanel } from "@/components/states";
import { useToast } from "@/components/toast";
import { Badge, Button, ButtonLink, Card, CardHeader, cn, EmptyState, LoadingRows, Notice, PageHeader } from "@/components/ui";
import { DEV_REQUEST_BODY, ELIGIBILITY_LABELS } from "@/domain/inbox/dev-request";
import type { InboxItem, SendResult } from "@/domain/inbox/service";
import { api } from "@/lib/client/api";
import { qk, useInbox, useSettings } from "@/lib/client/queries";
import { formatRelative } from "@/lib/format";

type Filter = "all" | "new" | "request" | "analysis";

const FILTERS: { key: Filter; label: string; test: (i: InboxItem) => boolean }[] = [
  { key: "all", label: "Tümü", test: () => true },
  { key: "new", label: "Yeni", test: (i) => i.isNew },
  { key: "request", label: "Bilgi talebi", test: (i) => isPendingRequest(i) },
  { key: "analysis", label: "Analiz bekliyor", test: (i) => i.analysis.state !== "ok" },
];

function isPendingRequest(i: InboxItem) {
  return i.devRequest.eligibility.eligible && i.devRequest.ledger?.state !== "sent" && i.devRequest.ledger?.state !== "skipped";
}

export function InboxView() {
  const settings = useSettings();
  const envOk = settings.data?.env.ok === true;
  const inbox = useInbox(envOk);
  const [filter, setFilter] = useState<Filter>("all");
  const jiraBaseUrl = settings.data?.env.ok ? settings.data.env.jiraBaseUrl : undefined;

  const items = useMemo(() => inbox.data?.items ?? [], [inbox.data]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, items.filter(f.test).length])) as Record<Filter, number>, [items]);
  const visible = items.filter(FILTERS.find((f) => f.key === filter)!.test);
  const pending = items.filter(isPendingRequest);

  return (
    <>
      <PageHeader
        eyebrow="Günlük iş"
        title="Gelen Kutusu"
        description="Size atanmış açık maddeler. Yeni gelenler, bilgi talebi gereken ve analizi bekleyen maddeler tek ekranda."
        action={
          envOk && (
            <Button onClick={() => inbox.refetch()} loading={inbox.isFetching}>
              {!inbox.isFetching && <RefreshCw className="size-4" />} Yenile
            </Button>
          )
        }
      />

      {settings.data && !envOk && <EnvMissing issues={settings.data.env.ok ? undefined : settings.data.env.issues} />}
      {inbox.isError && <ErrorPanel error={inbox.error} />}

      {envOk && (
        <div className="space-y-6">
          {pending.length > 0 && <DevRequestQueue items={pending} />}

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
              <div className="flex flex-wrap gap-1 rounded-xl bg-surface-2 p-1" role="tablist">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    role="tab"
                    aria-selected={filter === f.key}
                    onClick={() => setFilter(f.key)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all",
                      filter === f.key ? "bg-surface text-text shadow-card" : "text-muted hover:text-text",
                    )}
                  >
                    {f.label}
                    <span className={cn("rounded-full px-1.5 text-[11px]", filter === f.key ? "bg-accent-soft text-accent-text" : "bg-surface-3")}>
                      {inbox.data ? counts[f.key] : "–"}
                    </span>
                  </button>
                ))}
              </div>
              {inbox.data && <span className="text-xs text-subtle">Güncellendi: {formatRelative(inbox.data.fetchedAt)}</span>}
            </div>

            {inbox.isPending ? (
              <LoadingRows rows={6} />
            ) : visible.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title={filter === "all" ? "Size atanmış açık madde yok" : "Bu filtrede madde yok"}
                description={filter === "all" ? "Yeni bir madde atandığında burada görünecek." : undefined}
              />
            ) : (
              <div className="divide-y divide-border">
                {visible.map((item) => (
                  <IssueLine
                    key={item.key}
                    issue={item}
                    jiraBaseUrl={jiraBaseUrl}
                    badges={<ItemBadges item={item} />}
                    actions={<ItemAction item={item} />}
                  />
                ))}
              </div>
            )}
          </Card>

          {inbox.data && !inbox.data.developerFieldMapped && (
            <Notice tone="warning" title="Developer alanı eşlenmemiş">
              Bilgi talebi gönderebilmek için Ayarlar&apos;da &quot;Developer&quot; alanını eşleyin.
            </Notice>
          )}
        </div>
      )}
    </>
  );
}

function ItemBadges({ item }: { item: InboxItem }) {
  const ledger = item.devRequest.ledger;
  return (
    <>
      {item.isNew && (
        <Badge tone="accent" dot>
          Yeni
        </Badge>
      )}
      {ledger?.state === "sent" && <Badge tone="success">Bilgi istendi</Badge>}
      {ledger?.state === "unknown" && <Badge tone="warning">Gönderim doğrulanamadı</Badge>}
      {ledger?.state === "failed" && <Badge tone="danger">Gönderilemedi</Badge>}
      {item.analysis.state === "stale" && <Badge tone="warning">Analiz eskidi</Badge>}
      {item.analysis.state === "invalid" && <Badge tone="danger">Analiz geçersiz</Badge>}
    </>
  );
}

function ItemAction({ item }: { item: InboxItem }) {
  if (item.analysis.state === "ok") {
    return (
      <ButtonLink href={`/tests/${item.key}`} size="sm" variant="secondary">
        Teste başla <ArrowRight className="size-3.5" />
      </ButtonLink>
    );
  }
  return <CopyCommand value={`/jira-analiz ${item.key}`} />;
}

function DevRequestQueue({ items }: { items: InboxItem[] }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.map((i) => i.key)));
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();

  const send = useMutation({
    // Sunucu istek başına en fazla 50 madde kabul eder; seçim parçalara bölünüp sırayla gönderilir.
    mutationFn: async (chosen: InboxItem[]) => {
      const results: SendResult[] = [];
      for (let i = 0; i < chosen.length; i += 50) {
        const items = chosen.slice(i, i + 50).map((c) => ({
          key: c.key,
          developers: c.devRequest.eligibility.eligible ? c.devRequest.eligibility.developers.map((d) => d.accountId) : [],
        }));
        const res = await api<{ results: SendResult[] }>("/api/inbox/dev-requests", { method: "POST", json: { items, confirm: true } });
        results.push(...res.results);
      }
      return { results };
    },
    onSuccess: ({ results }) => {
      setConfirming(false);
      const sent = results.filter((r) => r.outcome === "sent" || r.outcome === "already-sent").length;
      const problems = results.filter((r) => r.outcome === "failed" || r.outcome === "unknown");
      const skipped = results.filter((r) => r.outcome === "skipped").length;
      toast({
        tone: problems.length ? "warning" : "success",
        title: `${sent} bilgi talebi gönderildi`,
        description: [skipped ? `${skipped} madde artık kurala uymadığı için atlandı.` : "", ...problems.map((p) => `${p.key}: ${p.message ?? ""}`)].filter(Boolean).join(" "),
      });
      queryClient.invalidateQueries({ queryKey: qk.inbox });
    },
    onError: (e) => toast({ tone: "error", title: "Gönderilemedi", description: e.message }),
  });

  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const chosen = items.filter((i) => selected.has(i.key));

  return (
    <Card className="overflow-hidden">
      <CardHeader
        icon={MessageSquareQuote}
        title={`Bilgi talebi bekleyen ${items.length} madde`}
        description="Component'i ve yorumu olmayan maddelerde Developer'a geliştirme bilgisi ve test ortamı doğrulaması sorulur. Gönderilmeden önce onaylarsınız."
      />
      <ul className="divide-y divide-border">
        {items.map((item) => {
          const elig = item.devRequest.eligibility;
          return (
            <li key={item.key} className="flex gap-4 px-5 py-4">
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
                checked={selected.has(item.key)}
                onChange={() => toggle(item.key)}
                aria-label={`${item.key} seç`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-mono text-[13px] font-semibold text-accent-text">{item.key}</span>{" "}
                  <span className="font-medium">{item.summary}</span>
                </p>
                <div className="mt-2 rounded-xl rounded-tl-sm border border-border bg-surface-2 px-3.5 py-2.5 text-[13px] leading-relaxed text-text/90">
                  {elig.eligible ? (
                    <>
                      Merhaba{" "}
                      {elig.developers.map((d, i) => (
                        <span key={d.accountId}>
                          {i > 0 && ", "}
                          <span className="rounded bg-accent-soft px-1 font-medium text-accent-text">@{d.displayName}</span>
                        </span>
                      ))}
                      , <br />
                      {DEV_REQUEST_BODY}
                    </>
                  ) : (
                    ELIGIBILITY_LABELS[elig.reason]
                  )}
                </div>
                {item.devRequest.ledger?.state === "unknown" && (
                  <p className="mt-1.5 text-xs text-warning">Önceki gönderim doğrulanamadı; yeniden denerseniz önce Jira kontrol edilir, mükerrer yorum atılmaz.</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border bg-surface-2 px-5 py-3">
        {confirming ? (
          <>
            <span className="text-sm">
              <strong>{chosen.length}</strong> maddeye sizin adınıza yorum eklenecek. Onaylıyor musunuz?
            </span>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Vazgeç
            </Button>
            <Button variant="primary" size="sm" loading={send.isPending} onClick={() => send.mutate(chosen)}>
              <Send className="size-4" /> Evet, gönder
            </Button>
          </>
        ) : (
          <Button variant="primary" size="sm" disabled={chosen.length === 0} onClick={() => setConfirming(true)}>
            <Sparkles className="size-4" /> Seçilenleri gönder ({chosen.length})
          </Button>
        )}
      </div>
    </Card>
  );
}
