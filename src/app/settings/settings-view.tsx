"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  CheckCircle2,
  FolderKanban,
  PlugZap,
  Plus,
  Save,
  Search,
  Send,
  SlidersHorizontal,
  Tags,
  Trash2,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EnvMissing, ErrorPanel } from "@/components/states";
import { useToast } from "@/components/toast";
import { Avatar, Badge, Button, Card, CardHeader, cn, Field, Input, LoadingRows, Notice, Select } from "@/components/ui";
import type { ConnectionCheck, ProjectSetup } from "@/domain/settings/connection-check";
import { PERMISSION_LABELS } from "@/domain/settings/permission-labels";
import { FIELD_SPECS, STATUS_SPECS, type FieldKey, type StatusRef, type TrackedProject } from "@/domain/settings/schema";
import type { ProjectSummary } from "@/lib/jira/operations";
import { api } from "@/lib/client/api";
import { qk, useSettings, type ClientSettings, type SettingsResponse } from "@/lib/client/queries";

type Draft = Pick<ClientSettings, "fields" | "projects" | "preferences">;

export function SettingsView() {
  const settings = useSettings();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savedJson, setSavedJson] = useState("");

  const saved = settings.data?.settings;
  useEffect(() => {
    if (saved && !draft) {
      const d = { fields: saved.fields, projects: saved.projects, preferences: saved.preferences };
      setDraft(d);
      setSavedJson(JSON.stringify(d));
    }
  }, [saved, draft]);

  const check = useQuery({
    queryKey: ["settings-check"],
    queryFn: () => api<ConnectionCheck>("/api/settings/check"),
    enabled: settings.data?.env.ok === true,
    staleTime: 5 * 60_000,
  });

  // İlk kurulumda alan önerileri boş alanlara yerleştirilir (kullanıcı seçimi ezilmez).
  useEffect(() => {
    if (!check.data || !draft || saved?.updatedAt) return;
    const fields = { ...draft.fields };
    let changed = false;
    for (const spec of FIELD_SPECS) {
      if (!fields[spec.key] && check.data.fields[spec.key].suggestion) {
        fields[spec.key] = check.data.fields[spec.key].suggestion;
        changed = true;
      }
    }
    if (changed) setDraft({ ...draft, fields });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check.data]);

  const save = useMutation({
    mutationFn: (value: Draft) => api<{ settings: ClientSettings }>("/api/settings", { method: "PUT", json: value }),
    onSuccess: (data) => {
      queryClient.setQueryData<SettingsResponse>(qk.settings, (old) => (old ? { ...old, settings: data.settings } : old));
      setSavedJson(JSON.stringify({ fields: data.settings.fields, projects: data.settings.projects, preferences: data.settings.preferences }));
      queryClient.invalidateQueries({ queryKey: ["releases"] });
      queryClient.invalidateQueries({ queryKey: qk.inbox });
      toast({ tone: "success", title: "Ayarlar kaydedildi" });
    },
    onError: (e) => toast({ tone: "error", title: "Kaydedilemedi", description: e.message }),
  });

  if (settings.isPending) return <Card><LoadingRows rows={5} /></Card>;
  if (settings.isError) return <ErrorPanel error={settings.error} />;
  if (!settings.data.env.ok) return <EnvMissing issues={settings.data.env.issues} />;

  const env = settings.data.env;
  const dirty = draft !== null && JSON.stringify(draft) !== savedJson;

  return (
    <div className="space-y-6 pb-24">
      <ConnectionCard env={env} check={check} />

      {draft && (
        <>
          <FieldsCard draft={draft} check={check.data} onChange={(key, ref) => setDraft({ ...draft, fields: { ...draft.fields, [key]: ref } })} />
          <ProjectsCard
            projects={draft.projects}
            onChange={(projects) => setDraft({ ...draft, projects })}
          />
          <TeamsCard targets={saved?.teams.targets ?? []} />
          <PreferencesCard value={draft.preferences} onChange={(preferences) => setDraft({ ...draft, preferences })} />
        </>
      )}

      <div
        className={cn(
          "fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 transition-all duration-200 md:left-64",
          dirty ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0",
        )}
      >
        <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface/95 px-5 py-3 shadow-pop backdrop-blur">
          <span className="text-sm text-muted">Kaydedilmemiş değişiklikler var</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (savedJson) setDraft(JSON.parse(savedJson) as Draft);
            }}
          >
            Vazgeç
          </Button>
          <Button variant="primary" size="sm" loading={save.isPending} onClick={() => draft && save.mutate(draft)}>
            <Save className="size-4" /> Kaydet
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Bağlantı ─────────────────────────────────────────────────────────────────

function ConnectionCard({
  env,
  check,
}: {
  env: { jiraBaseUrl: string; jiraEmail: string };
  check: ReturnType<typeof useQuery<ConnectionCheck>>;
}) {
  return (
    <Card>
      <CardHeader
        icon={PlugZap}
        title="Jira bağlantısı"
        description=".env.local dosyasından okunur. Bu test yalnızca okuma yapar."
        action={
          <Button size="sm" onClick={() => check.refetch()} loading={check.isFetching}>
            Yeniden test et
          </Button>
        }
      />
      <div className="grid gap-5 p-5 md:grid-cols-[1fr_1.2fr]">
        <dl className="grid content-start gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-subtle">Adres</dt>
            <dd className="mt-0.5 truncate font-medium">{env.jiraBaseUrl}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-subtle">Kullanıcı</dt>
            <dd className="mt-0.5 truncate font-medium">{env.jiraEmail}</dd>
          </div>
        </dl>
        <div>
          {check.isPending && check.isFetching && <LoadingRows rows={1} />}
          {check.isError && <ErrorPanel error={check.error} />}
          {check.data && (
            <div className="flex items-center gap-4 rounded-xl bg-success-soft p-4">
              <Avatar name={check.data.myself.displayName} url={check.data.myself.avatarUrl} size={44} />
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-semibold text-success">
                  <CheckCircle2 className="size-4" /> Bağlantı başarılı
                </p>
                <p className="truncate text-sm">{check.data.myself.displayName}</p>
                {check.data.myself.emailAddress && <p className="truncate text-xs text-muted">{check.data.myself.emailAddress}</p>}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Alanlar ──────────────────────────────────────────────────────────────────

function FieldsCard({
  draft,
  check,
  onChange,
}: {
  draft: Draft;
  check: ConnectionCheck | undefined;
  onChange: (key: FieldKey, ref: { id: string; name: string } | undefined) => void;
}) {
  return (
    <Card>
      <CardHeader icon={Tags} title="Alan eşlemesi" description="Uygulamanın okuyacağı ve dolduracağı Jira özel alanları. Öneriler Jira'dan gelir." />
      <div className="grid gap-5 p-5 md:grid-cols-3">
        {FIELD_SPECS.map((spec) => {
          const discovery = check?.fields[spec.key];
          const current = draft.fields[spec.key];
          const options = discovery?.candidates ?? [];
          const hasCurrent = current && options.some((o) => o.id === current.id);
          return (
            <Field key={spec.key} label={spec.label} hint={spec.description} htmlFor={`f-${spec.key}`}>
              <Select
                id={`f-${spec.key}`}
                value={current?.id ?? ""}
                disabled={!check && !current}
                onChange={(e) => {
                  const picked = options.find((o) => o.id === e.target.value);
                  onChange(spec.key, picked ? { id: picked.id, name: picked.name } : undefined);
                }}
              >
                <option value="">{check ? "Seçilmedi" : "Bağlantı bekleniyor…"}</option>
                {current && !hasCurrent && (
                  <option value={current.id}>
                    {current.name} ({current.id})
                  </option>
                )}
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} · {o.type}
                    {o.typeMatches ? "" : " (tip uyumsuz)"}
                  </option>
                ))}
              </Select>
              {check && options.length === 0 && <p className="text-xs text-warning">Bu adla bir alan bulunamadı.</p>}
            </Field>
          );
        })}
      </div>
    </Card>
  );
}

// ── Projeler ─────────────────────────────────────────────────────────────────

function ProjectsCard({ projects, onChange }: { projects: Record<string, TrackedProject>; onChange: (p: Record<string, TrackedProject>) => void }) {
  const keys = Object.keys(projects);
  const [adding, setAdding] = useState(keys.length === 0);
  const [query, setQuery] = useState("");
  const all = useQuery({ queryKey: ["projects"], queryFn: () => api<{ projects: ProjectSummary[] }>("/api/projects"), enabled: adding, staleTime: 10 * 60_000 });
  const setups = useQueries({
    queries: keys.map((key) => ({ queryKey: ["project-setup", key], queryFn: () => api<ProjectSetup>(`/api/projects/${key}`), staleTime: 10 * 60_000 })),
  });
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    return (all.data?.projects ?? [])
      .filter((p) => !projects[p.key])
      .filter((p) => !q || p.key.toLocaleLowerCase("tr").includes(q) || p.name.toLocaleLowerCase("tr").includes(q))
      .slice(0, 30);
  }, [all.data, query, projects]);

  async function add(key: string) {
    setPending(key);
    try {
      const setup = await api<ProjectSetup>(`/api/projects/${key}`);
      onChange({ ...projects, [key]: setup.suggestion });
      setAdding(false);
      setQuery("");
      toast({ tone: "info", title: `${setup.name} eklendi`, description: "Statü eşlemesini kontrol edip kaydedin." });
    } catch (e) {
      toast({ tone: "error", title: "Proje eklenemedi", description: e instanceof Error ? e.message : undefined });
    } finally {
      setPending(null);
    }
  }

  return (
    <Card id="projects">
      <CardHeader
        icon={FolderKanban}
        title="Takip edilen projeler"
        description="Release panosu ve release kapatma bu projeler için çalışır. Gelen kutusu tüm projelerdeki maddelerinizi gösterir."
        action={
          !adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Proje ekle
            </Button>
          )
        }
      />
      {adding && (
        <div className="border-b border-border bg-surface-2 p-5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input autoFocus placeholder="Proje adı ya da anahtarı ile arayın…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
          </div>
          <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface">
            {all.isPending && <LoadingRows rows={3} />}
            {all.isError && (
              <div className="p-3">
                <ErrorPanel error={all.error} />
              </div>
            )}
            {all.data && filtered.length === 0 && <p className="p-4 text-sm text-muted">Eşleşen proje yok.</p>}
            <ul className="divide-y divide-border">
              {filtered.map((p) => (
                <li key={p.key}>
                  <button
                    type="button"
                    onClick={() => add(p.key)}
                    disabled={pending !== null}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent-soft disabled:opacity-60"
                  >
                    {p.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.avatarUrl} alt="" width={22} height={22} className="rounded" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="size-5.5 rounded bg-surface-3" />
                    )}
                    <span className="w-24 shrink-0 font-mono text-xs font-semibold text-accent-text">{p.key}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                    {p.teamManaged && <Badge>team-managed</Badge>}
                    {pending === p.key ? <span className="text-xs text-muted">ekleniyor…</span> : <Plus className="size-4 text-subtle" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {keys.length > 0 && (
            <div className="mt-3 flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Kapat
              </Button>
            </div>
          )}
        </div>
      )}

      {keys.length === 0 && !adding && <p className="p-5 text-sm text-muted">Henüz proje eklenmedi.</p>}

      <div className="divide-y divide-border">
        {keys.map((key, i) => (
          <ProjectRow
            key={key}
            projectKey={key}
            value={projects[key]!}
            setup={setups[i]?.data}
            setupError={setups[i]?.error ?? undefined}
            onChange={(v) => onChange({ ...projects, [key]: v })}
            onRemove={() => {
              const next = { ...projects };
              delete next[key];
              onChange(next);
            }}
          />
        ))}
      </div>
    </Card>
  );
}

function ProjectRow({
  projectKey,
  value,
  setup,
  setupError,
  onChange,
  onRemove,
}: {
  projectKey: string;
  value: TrackedProject;
  setup: ProjectSetup | undefined;
  setupError: Error | undefined;
  onChange: (v: TrackedProject) => void;
  onRemove: () => void;
}) {
  const statuses = useMemo(() => [...(setup?.statuses ?? [])].sort((a, b) => a.name.localeCompare(b.name, "tr")), [setup]);
  const known = (ref: StatusRef) => statuses.some((s) => s.id === ref.id);
  const toRef = (id: string): StatusRef | undefined => {
    const s = statuses.find((x) => x.id === id);
    return s ? { id: s.id, name: s.name } : undefined;
  };
  const inTestIds = new Set(value.inTest.map((s) => s.id));
  const inTestOptions = [
    ...statuses.filter((s) => s.statusCategory?.key !== "done").map((s) => ({ ref: { id: s.id, name: s.name }, missing: false })),
    ...(setup ? value.inTest.filter((s) => !known(s)).map((ref) => ({ ref, missing: true })) : []),
  ];
  const missingPerms = setup ? Object.entries(PERMISSION_LABELS).filter(([k]) => !setup.permissions[k]) : [];

  return (
    <div className="p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="rounded-lg bg-accent-soft px-2 py-1 font-mono text-xs font-semibold text-accent-text">{projectKey}</span>
        <h3 className="text-[15px] font-semibold">{setup?.name ?? value.name}</h3>
        {setup && (missingPerms.length === 0 ? <Badge tone="success" dot>Tüm yetkiler var</Badge> : <Badge tone="warning" dot>{missingPerms.length} yetki eksik</Badge>)}
        <Button variant="ghost" size="sm" className="ml-auto text-danger hover:text-danger" onClick={onRemove}>
          <Trash2 className="size-4" /> Kaldır
        </Button>
      </div>

      {setupError && <ErrorPanel error={setupError} />}

      <div className="grid gap-4 md:grid-cols-2">
        {STATUS_SPECS.map((spec) => {
          const current = value[spec.key];
          return (
            <Field key={spec.key} label={spec.label} hint={spec.description}>
              <Select value={current?.id ?? ""} disabled={!setup && !current} onChange={(e) => onChange({ ...value, [spec.key]: toRef(e.target.value) })}>
                <option value="">{setup ? "Seçilmedi" : "Statüler yükleniyor…"}</option>
                {current && !known(current) && <option value={current.id}>{current.name}</option>}
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          );
        })}
      </div>

      <div className="mt-4">
        <p className="text-[13px] font-medium">Testte sayılan statüler</p>
        <p className="mb-2 text-xs text-muted">Bekleme süresi uyarıları bu statülere göre hesaplanır.</p>
        <div className="flex flex-wrap gap-2">
          {(setup ? inTestOptions : value.inTest.map((ref) => ({ ref, missing: false }))).map(({ ref, missing }) => {
            const checked = inTestIds.has(ref.id);
            return (
              <button
                type="button"
                key={ref.id}
                disabled={!setup}
                aria-pressed={checked}
                title={missing ? "Bu statü Jira'da artık yok — kaldırmak için tıklayın" : undefined}
                onClick={() => onChange({ ...value, inTest: checked ? value.inTest.filter((x) => x.id !== ref.id) : [...value.inTest, ref] })}
                className={cn(
                  "rounded-full border px-3 py-1 text-[13px] transition-colors",
                  missing
                    ? "border-warning/40 bg-warning-soft text-warning line-through"
                    : checked
                      ? "border-transparent bg-accent text-white"
                      : "border-border bg-surface hover:border-accent hover:text-accent-text",
                )}
              >
                {ref.name}
              </button>
            );
          })}
        </div>
      </div>

      {missingPerms.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {missingPerms.map(([k, info]) => (
            <span key={k} className="inline-flex items-center gap-1.5 rounded-lg bg-warning-soft px-2.5 py-1 text-xs text-warning" title={info.neededFor}>
              <XCircle className="size-3.5" /> {info.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Teams ────────────────────────────────────────────────────────────────────

function TeamsCard({ targets }: { targets: { id: string; name: string; url: string }[] }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const update = (s: ClientSettings) => queryClient.setQueryData<SettingsResponse>(qk.settings, (old) => (old ? { ...old, settings: s } : old));

  const add = useMutation({
    mutationFn: () => api<{ settings: ClientSettings }>("/api/teams/targets", { method: "POST", json: { name, url } }),
    onSuccess: (d) => {
      update(d.settings);
      setName("");
      setUrl("");
      toast({ tone: "success", title: "Teams hedefi eklendi", description: "Deneme kartı göndererek doğrulayın." });
    },
    onError: (e) => toast({ tone: "error", title: "Eklenemedi", description: e.message }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<{ settings: ClientSettings }>(`/api/teams/targets/${id}`, { method: "DELETE" }),
    onSuccess: (d) => update(d.settings),
  });
  const test = useMutation({
    mutationFn: (id: string) => api(`/api/teams/targets/${id}/test`, { method: "POST", json: { confirm: true } }),
    onSuccess: () => toast({ tone: "success", title: "Deneme kartı gönderildi", description: "Teams kanalını kontrol edin." }),
    onError: (e) => toast({ tone: "error", title: "Gönderilemedi", description: e.message }),
  });

  return (
    <Card>
      <CardHeader icon={BellRing} title="Teams bildirimleri" description="Release kapatma ve test sonuçları seçtiğiniz kanala Adaptive Card olarak gönderilir." />
      <div className="grid gap-6 p-5 lg:grid-cols-[1fr_1fr]">
        <div>
          {targets.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border-strong p-4 text-sm text-muted">Henüz hedef eklenmedi.</p>
          ) : (
            <ul className="space-y-2">
              {targets.map((t) => (
                <li key={t.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                  <span className="grid size-9 place-items-center rounded-lg bg-info-soft text-info">
                    <BellRing className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.name}</p>
                    <p className="truncate font-mono text-xs text-subtle">{t.url}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => test.mutate(t.id)} loading={test.isPending && test.variables === t.id} title="Deneme kartı gönder">
                    <Send className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => remove.mutate(t.id)} title="Kaldır">
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <form
          className="space-y-3 rounded-xl bg-surface-2 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Field label="Ad" htmlFor="t-name">
            <Input id="t-name" placeholder="ör. QA Ekibi kanalı" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field
            label="Webhook adresi"
            htmlFor="t-url"
            hint={
              <>
                Teams'te kanal → <strong>Workflows</strong> → &quot;Post to a channel when a webhook request is received&quot; şablonunu kurun ve
                verilen adresi buraya yapıştırın. Adres sır gibidir; ekranda maskelenir.
              </>
            }
          >
            <Input id="t-url" placeholder="https://…webhook.office.com/… ya da …logic.azure.com/…" value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" size="sm" disabled={!name.trim() || !url.trim()} loading={add.isPending}>
              <Plus className="size-4" /> Hedef ekle
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}

// ── Tercihler ────────────────────────────────────────────────────────────────

function PreferencesCard({ value, onChange }: { value: Draft["preferences"]; onChange: (v: Draft["preferences"]) => void }) {
  return (
    <Card>
      <CardHeader icon={SlidersHorizontal} title="Tercihler" />
      <div className="grid gap-5 p-5 md:grid-cols-2">
        <Field label="Uzun süredir testte (gün)" hint="Bu kadar günden uzun testte bekleyen madde uyarı alır." htmlFor="p-stale">
          <Input
            id="p-stale"
            type="number"
            min={1}
            max={90}
            value={value.staleTestDays}
            onChange={(e) => onChange({ ...value, staleTestDays: Math.max(1, Math.min(90, Number(e.target.value) || 1)) })}
          />
        </Field>
        <Field label="Release yaklaşıyor (gün)" hint="Bu kadar gün içinde çıkacak release vurgulanır." htmlFor="p-soon">
          <Input
            id="p-soon"
            type="number"
            min={1}
            max={60}
            value={value.releaseSoonDays}
            onChange={(e) => onChange({ ...value, releaseSoonDays: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })}
          />
        </Field>
      </div>
      <div className="px-5 pb-5">
        <Notice tone="info" title="Veriler bu bilgisayarda kalır">
          Ayarlar, test sonuçları ve kayıtlar proje klasöründeki <code className="font-mono">data/</code> içinde JSON olarak tutulur.
        </Notice>
      </div>
    </Card>
  );
}
