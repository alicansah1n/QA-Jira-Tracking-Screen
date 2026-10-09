"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  CheckCircle2,
  FolderKanban,
  Hash,
  KeyRound,
  MessagesSquare,
  PlugZap,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  SlidersHorizontal,
  Tags,
  Trash2,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CopyCommand } from "@/components/copy-button";
import { HelpButton, Modal } from "@/components/modal";
import { RecipientPicker, validContactIds } from "@/components/recipient-picker";
import { EnvMissing, ErrorPanel } from "@/components/states";
import { useToast } from "@/components/toast";
import { Avatar, Badge, Button, Card, cn, Field, Input, LoadingRows, Select } from "@/components/ui";
import type { ConnectionCheck, ProjectSetup } from "@/domain/settings/connection-check";
import { PERMISSION_LABELS } from "@/domain/settings/permission-labels";
import {
  FIELD_SPECS,
  MAX_TEAMS_RECIPIENTS,
  MAX_TEAMS_TEST_RECIPIENTS,
  STATUS_SPECS,
  TEAMS_TARGET_KINDS,
  type FieldKey,
  type StatusRef,
  type TeamsContact,
  type TeamsTargetKind,
  type TrackedProject,
} from "@/domain/settings/schema";
import type { ProjectSummary } from "@/lib/jira/operations";
import { api } from "@/lib/client/api";
import { qk, useSettings, type ClientSettings, type PublicTeamsTarget, type SettingsResponse } from "@/lib/client/queries";

type Draft = Pick<ClientSettings, "fields" | "projects" | "preferences">;
type TabId = "baglanti" | "alanlar" | "projects" | "teams" | "tercihler";
type TabState = "ok" | "warn" | "none";

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "baglanti", label: "Bağlantı", icon: PlugZap },
  { id: "alanlar", label: "Jira alanları", icon: Tags },
  { id: "projects", label: "Projeler", icon: FolderKanban },
  { id: "teams", label: "Teams", icon: BellRing },
  { id: "tercihler", label: "Tercihler", icon: SlidersHorizontal },
];

const isTab = (v: string): v is TabId => TABS.some((t) => t.id === v);

/** Seçili sekme adres çubuğundaki #parça ile eşlenir (ör. /settings#projects bağlantıları). */
function useTab(): [TabId, (t: TabId) => void] {
  const [tab, setTab] = useState<TabId>("baglanti");
  useEffect(() => {
    const sync = () => {
      const h = window.location.hash.slice(1);
      if (isTab(h)) setTab(h);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return [
    tab,
    (t) => {
      setTab(t);
      window.history.replaceState(null, "", `#${t}`);
    },
  ];
}

export function SettingsView() {
  const settings = useSettings();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useTab();
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
  const targets = saved?.teams.targets ?? [];
  const contacts = saved?.teams.contacts ?? [];

  const states: Record<TabId, TabState> = {
    baglanti: check.data ? "ok" : check.isError ? "warn" : "none",
    alanlar: draft && FIELD_SPECS.every((s) => draft.fields[s.key]) ? "ok" : "warn",
    projects:
      draft && Object.keys(draft.projects).length > 0 && Object.values(draft.projects).every((p) => p.toBeDeployed && p.completed) ? "ok" : "warn",
    teams: targets.length > 0 ? "ok" : "none",
    tercihler: "none",
  };

  return (
    <div className="grid gap-6 pb-24 md:grid-cols-[13rem_1fr]">
      <nav aria-label="Ayar bölümleri" className="md:sticky md:top-6 md:self-start">
        <ul className="flex gap-1 overflow-x-auto md:flex-col">
          {TABS.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm whitespace-nowrap transition-colors",
                  tab === t.id ? "bg-accent-soft font-semibold text-accent-text" : "text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                <t.icon className="size-4 shrink-0" aria-hidden />
                <span className="flex-1">{t.label}</span>
                <StateDot state={states[t.id]} />
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 space-y-6">
        {tab === "baglanti" && <ConnectionSection env={env} check={check} />}
        {draft && tab === "alanlar" && (
          <FieldsSection draft={draft} check={check.data} onChange={(key, ref) => setDraft({ ...draft, fields: { ...draft.fields, [key]: ref } })} />
        )}
        {draft && tab === "projects" && <ProjectsSection projects={draft.projects} onChange={(projects) => setDraft({ ...draft, projects })} />}
        {tab === "teams" && (
          <>
            <TargetsSection targets={targets} contacts={contacts} />
            <ContactsSection contacts={contacts} />
          </>
        )}
        {draft && tab === "tercihler" && <PreferencesSection value={draft.preferences} onChange={(preferences) => setDraft({ ...draft, preferences })} />}
      </div>

      <div
        className={cn(
          "fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 transition-all duration-200 md:left-64",
          dirty ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0",
        )}
      >
        <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface/95 px-5 py-3 shadow-pop backdrop-blur">
          <span className="text-sm text-muted">Kaydedilmemiş değişiklik var</span>
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

function StateDot({ state }: { state: TabState }) {
  if (state === "none") return null;
  return (
    <span
      className={cn("size-2 shrink-0 rounded-full", state === "ok" ? "bg-success" : "bg-warning")}
      title={state === "ok" ? "Hazır" : "Eksik var"}
      aria-label={state === "ok" ? "Hazır" : "Eksik var"}
    />
  );
}

/** Bölüm kartı: başlık, yanında "?" bilgi düğmesi ve sağda eylem. Açıklama metni bilgi penceresinde. */
function Section({
  icon: Icon,
  title,
  help,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  help: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text">
            <Icon className="size-4" aria-hidden />
          </span>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <HelpButton title={title}>{help}</HelpButton>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border-strong p-4 text-center text-sm text-muted">{children}</p>;
}

// ── Bağlantı ─────────────────────────────────────────────────────────────────

function ConnectionSection({
  env,
  check,
}: {
  env: { jiraBaseUrl: string; jiraEmail: string };
  check: ReturnType<typeof useQuery<ConnectionCheck>>;
}) {
  return (
    <Section
      icon={PlugZap}
      title="Jira bağlantısı"
      help={
        <>
          <p>
            Adres, e-posta ve token proje klasöründeki <strong>.env.local</strong> dosyasından okunur. Değiştirdikten sonra uygulamayı yeniden başlatın.
          </p>
          <p>
            <strong>Bağlantı başarısızsa:</strong> e-posta, token&apos;ı oluşturan Atlassian hesabının e-postası olmalı; token iptal edilmiş ya da eksik
            kopyalanmış olabilir.
          </p>
          <p>Test yalnızca okuma yapar, Jira&apos;da hiçbir şeyi değiştirmez.</p>
        </>
      }
      action={
        <Button size="sm" onClick={() => check.refetch()} loading={check.isFetching}>
          <RefreshCw className="size-4" /> Test et
        </Button>
      }
    >
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <dl className="grid content-start gap-3 text-sm">
          <div>
            <dt className="text-xs text-subtle">Adres</dt>
            <dd className="truncate font-medium">{env.jiraBaseUrl}</dd>
          </div>
          <div>
            <dt className="text-xs text-subtle">E-posta</dt>
            <dd className="truncate font-medium">{env.jiraEmail}</dd>
          </div>
        </dl>
        <div>
          {check.isPending && check.isFetching && <LoadingRows rows={1} />}
          {check.isError && <ErrorPanel error={check.error} />}
          {check.data && (
            <div className="flex items-center gap-3 rounded-xl bg-success-soft p-4">
              <Avatar name={check.data.myself.displayName} url={check.data.myself.avatarUrl} size={40} />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-success">
                  <CheckCircle2 className="size-4" /> Bağlı
                </p>
                <p className="truncate text-sm">{check.data.myself.displayName}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

// ── Alanlar ──────────────────────────────────────────────────────────────────

function FieldsSection({
  draft,
  check,
  onChange,
}: {
  draft: Draft;
  check: ConnectionCheck | undefined;
  onChange: (key: FieldKey, ref: { id: string; name: string } | undefined) => void;
}) {
  return (
    <Section
      icon={Tags}
      title="Jira alanları"
      help={
        <>
          <p>Uygulamanın okuyup dolduracağı özel alanlar. Jira&apos;da bu adlarla bulunan alanlar otomatik önerilir.</p>
          <ul className="list-disc space-y-1 pl-5">
            {FIELD_SPECS.map((s) => (
              <li key={s.key}>
                <strong>{s.label}:</strong> {s.description}
              </li>
            ))}
          </ul>
          <p>
            <strong>(tip uyumsuz)</strong> yazan alanlar beklenen türde değil; yanlış alan olabilir.
          </p>
        </>
      }
    >
      <div className="grid gap-4 p-5 md:grid-cols-3">
        {FIELD_SPECS.map((spec) => {
          const discovery = check?.fields[spec.key];
          const current = draft.fields[spec.key];
          const options = discovery?.candidates ?? [];
          const hasCurrent = current && options.some((o) => o.id === current.id);
          return (
            <Field key={spec.key} label={spec.label} htmlFor={`f-${spec.key}`}>
              <Select
                id={`f-${spec.key}`}
                value={current?.id ?? ""}
                disabled={!check && !current}
                onChange={(e) => {
                  const picked = options.find((o) => o.id === e.target.value);
                  onChange(spec.key, picked ? { id: picked.id, name: picked.name } : undefined);
                }}
              >
                <option value="">{check ? "Seçilmedi" : "Yükleniyor…"}</option>
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
              {check && options.length === 0 && <p className="text-xs text-warning">Jira&apos;da bulunamadı</p>}
            </Field>
          );
        })}
      </div>
    </Section>
  );
}

// ── Projeler ─────────────────────────────────────────────────────────────────

function ProjectsSection({ projects, onChange }: { projects: Record<string, TrackedProject>; onChange: (p: Record<string, TrackedProject>) => void }) {
  const keys = Object.keys(projects);
  const [adding, setAdding] = useState(false);
  const setups = useQueries({
    queries: keys.map((key) => ({ queryKey: ["project-setup", key], queryFn: () => api<ProjectSetup>(`/api/projects/${key}`), staleTime: 10 * 60_000 })),
  });

  return (
    <Section
      icon={FolderKanban}
      title="Projeler"
      help={
        <>
          <p>Release panosu ve release kapatma yalnızca buradaki projeler için çalışır. Gelen kutusu tüm projelerdeki maddelerinizi gösterir.</p>
          <ul className="list-disc space-y-1 pl-5">
            {STATUS_SPECS.map((s) => (
              <li key={s.key}>
                <strong>{s.label}:</strong> {s.description}
              </li>
            ))}
            <li>
              <strong>Testte:</strong> bekleme süresi uyarıları bu statülere göre hesaplanır.
            </li>
          </ul>
          <p>
            <strong>Eksik yetki</strong> rozeti, ilgili işlemin o projede yapılamayacağını gösterir (üzerine gelince hangi işlem için gerektiği yazar).
          </p>
          <p>Değişiklikler alttaki Kaydet ile kalıcı olur.</p>
        </>
      }
      action={
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-4" /> Proje ekle
        </Button>
      }
    >
      {keys.length === 0 ? (
        <div className="p-5">
          <Empty>Henüz proje yok. &quot;Proje ekle&quot; ile başlayın.</Empty>
        </div>
      ) : (
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
      )}
      <AddProjectModal open={adding} onClose={() => setAdding(false)} tracked={projects} onAdd={(key, p) => onChange({ ...projects, [key]: p })} />
    </Section>
  );
}

function AddProjectModal({
  open,
  onClose,
  tracked,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  tracked: Record<string, TrackedProject>;
  onAdd: (key: string, p: TrackedProject) => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const all = useQuery({ queryKey: ["projects"], queryFn: () => api<{ projects: ProjectSummary[] }>("/api/projects"), enabled: open, staleTime: 10 * 60_000 });

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    return (all.data?.projects ?? [])
      .filter((p) => !tracked[p.key])
      .filter((p) => !q || p.key.toLocaleLowerCase("tr").includes(q) || p.name.toLocaleLowerCase("tr").includes(q))
      .slice(0, 50);
  }, [all.data, query, tracked]);

  async function add(key: string) {
    setPending(key);
    try {
      const setup = await api<ProjectSetup>(`/api/projects/${key}`);
      onAdd(key, setup.suggestion);
      setQuery("");
      onClose();
      toast({ tone: "info", title: `${setup.name.trim()} eklendi`, description: "Statüleri kontrol edip kaydedin." });
    } catch (e) {
      toast({ tone: "error", title: "Proje eklenemedi", description: e instanceof Error ? e.message : undefined });
    } finally {
      setPending(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Proje ekle">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
        <Input autoFocus placeholder="Proje adı ya da anahtarı" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
      </div>
      <div className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-border">
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
                <span className="w-20 shrink-0 font-mono text-xs font-semibold text-accent-text">{p.key}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{p.name.trim()}</span>
                {pending === p.key ? <span className="text-xs text-muted">ekleniyor…</span> : <Plus className="size-4 text-subtle" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
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
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="rounded-lg bg-accent-soft px-2 py-1 font-mono text-xs font-semibold text-accent-text">{projectKey}</span>
        <h3 className="text-[15px] font-semibold">{(setup?.name ?? value.name).trim()}</h3>
        {setup && missingPerms.length === 0 && (
          <Badge tone="success" dot>
            Yetkiler tam
          </Badge>
        )}
        <Button variant="ghost" size="sm" className="ml-auto text-danger hover:text-danger" onClick={onRemove} title="Projeyi kaldır">
          <Trash2 className="size-4" />
        </Button>
      </div>

      {setupError && <ErrorPanel error={setupError} />}

      <div className="grid gap-4 sm:grid-cols-2">
        {STATUS_SPECS.map((spec) => {
          const current = value[spec.key];
          return (
            <Field key={spec.key} label={spec.label}>
              <Select value={current?.id ?? ""} disabled={!setup && !current} onChange={(e) => onChange({ ...value, [spec.key]: toRef(e.target.value) })}>
                <option value="">{setup ? "Seçilmedi" : "Yükleniyor…"}</option>
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

      <div>
        <p className="mb-2 text-[13px] font-medium">Testte sayılan statüler</p>
        <div className="flex flex-wrap gap-1.5">
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
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">Eksik yetki:</span>
          {missingPerms.map(([k, info]) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-lg bg-warning-soft px-2 py-0.5 text-xs text-warning" title={info.neededFor}>
              <XCircle className="size-3.5" /> {info.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Teams ────────────────────────────────────────────────────────────────────

const KIND_META: Record<TeamsTargetKind, { icon: LucideIcon; hint: string; placeholder: string }> = {
  channel: { icon: Hash, hint: "Bir ekip kanalına", placeholder: "ör. QA Ekibi" },
  chat: { icon: MessagesSquare, hint: "Sabit bir grup sohbetine", placeholder: "ör. Release sohbeti" },
  people: { icon: Users, hint: "Her seferinde seçtiğiniz kişilere", placeholder: "ör. Kişilere gönder" },
};

const code = "rounded bg-surface-3 px-1 font-mono text-[11px] text-text";

/** Hedef türüne göre Teams/Power Automate'te yapılacaklar. */
function KindSteps({ kind }: { kind: TeamsTargetKind }) {
  if (kind !== "people") {
    const where = kind === "channel" ? "kanalın" : "sohbetin";
    const word = kind === "channel" ? "kanal" : "sohbet";
    return (
      <ol className="list-decimal space-y-1 pl-4">
        <li>
          Teams&apos;te {where} <strong>⋯</strong> menüsü → <strong>İş Akışları</strong>
        </li>
        <li>
          Aramaya <strong>web kancası</strong> yazın, adında &quot;{word}&quot; geçen şablonu seçin
        </li>
        <li>Kurulum bitince verilen adresi kopyalayın</li>
      </ol>
    );
  }
  return (
    <ol className="list-decimal space-y-2 pl-4">
      <li>
        <strong>make.powerautomate.com</strong> → Oluştur → <strong>Anlık bulut akışı</strong> → tetikleyici seçmeden Atla
      </li>
      <li>
        Tetikleyici: <strong>Bir Teams web kancası isteği alındığında</strong> · Kimler tetikleyebilir: <strong>Herkes</strong>
      </li>
      <li>
        <strong>Koşul</strong> ekleyin: sol tarafa aşağıdaki ifade, işleç <strong>eşittir</strong>, sağa <code className={code}>true</code>. Hayır dalına{" "}
        <strong>Sonlandır</strong>.
        <code className={cn(code, "mt-1 block p-1.5 break-all")}>
          and(equals(triggerOutputs()?[&apos;headers&apos;]?[&apos;x-qa-key&apos;], &apos;AKIS_ANAHTARI&apos;),
          lessOrEquals(length(coalesce(triggerBody()?[&apos;recipients&apos;], json(&apos;[]&apos;))), {MAX_TEAMS_RECIPIENTS}))
        </code>
      </li>
      <li>
        Evet dalına <strong>Her biri için</strong>: <code className={code}>triggerBody()?[&apos;recipients&apos;]</code>
      </li>
      <li>
        İçine <strong>Sohbette veya kanalda kart gönder</strong>: Flow bot · Flow bot ile sohbet · Alıcı <code className={code}>item()</code> · Kart{" "}
        <code className={code}>triggerBody()?[&apos;attachments&apos;]?[0]?[&apos;content&apos;]</code>
      </li>
      <li>
        Kaydedin, <strong>HTTP URL</strong>&apos;yi buraya yapıştırıp hedefi ekleyin. Listede çıkan <strong>akış anahtarını</strong>{" "}
        <code className={code}>AKIS_ANAHTARI</code> yerine yazıp akışı tekrar kaydedin.
      </li>
    </ol>
  );
}

function TargetsSection({ targets, contacts }: { targets: PublicTeamsTarget[]; contacts: TeamsContact[] }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [testing, setTesting] = useState<PublicTeamsTarget | null>(null);
  const update = (s: ClientSettings) => queryClient.setQueryData<SettingsResponse>(qk.settings, (old) => (old ? { ...old, settings: s } : old));

  const remove = useMutation({
    mutationFn: (id: string) => api<{ settings: ClientSettings }>(`/api/teams/targets/${id}`, { method: "DELETE" }),
    onSuccess: (d) => update(d.settings),
    onError: (e) => toast({ tone: "error", title: "Silinemedi", description: e.message }),
  });
  const test = useMutation({
    mutationFn: ({ id, contactIds }: { id: string; contactIds: string[] }) =>
      api(`/api/teams/targets/${id}/test`, { method: "POST", json: { contactIds, confirm: true } }),
    onSuccess: () => {
      setTesting(null);
      toast({ tone: "success", title: "Deneme kartı gönderildi", description: "Teams'te kontrol edin." });
    },
    onError: (e) => toast({ tone: "error", title: "Gönderilemedi", description: e.message }),
  });

  return (
    <Section
      icon={BellRing}
      title="Teams hedefleri"
      help={
        <>
          <p>Release kapatma ve test sonuçları, gönderirken seçtiğiniz hedefe kart olarak gider. Üç tür var:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Kanal:</strong> bir ekip kanalı. Her kanal için ayrı adres.
            </li>
            <li>
              <strong>Sohbet:</strong> sabit bir grup sohbeti. Her sohbet için ayrı adres.
            </li>
            <li>
              <strong>Kişiler:</strong> tek bir genel akış; her gönderimde kişi listesinden seçtiğiniz kişilere ayrı ayrı gider.
            </li>
          </ul>
          <p>
            Adresler (ve Kişiler hedefinin anahtarı) şifre gibidir; ekranda maskelenir. Kurulum adımları &quot;Hedef ekle&quot; penceresinde türe göre
            gösterilir.
          </p>
          <p>Teams isteği her zaman &quot;alındı&quot; diye cevaplar; iletilemeyen kartlar akışın çalışma geçmişinde görünür.</p>
        </>
      }
      action={
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-4" /> Hedef ekle
        </Button>
      }
    >
      <div className="p-5">
        {targets.length === 0 ? (
          <Empty>Henüz hedef yok. Bildirimler opsiyoneldir.</Empty>
        ) : (
          <ul className="space-y-2">
            {targets.map((t) => {
              const KindIcon = KIND_META[t.kind].icon;
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-info-soft text-info" title={TEAMS_TARGET_KINDS[t.kind]}>
                    <KindIcon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
                      <span className="truncate">{t.name}</span>
                      <Badge className="shrink-0">{TEAMS_TARGET_KINDS[t.kind]}</Badge>
                    </p>
                    <p className="truncate font-mono text-xs text-subtle">{t.url}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Deneme kartı gönder"
                    loading={test.isPending && test.variables?.id === t.id && t.kind !== "people"}
                    onClick={() => (t.kind === "people" ? setTesting(t) : test.mutate({ id: t.id, contactIds: [] }))}
                  >
                    <Send className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => remove.mutate(t.id)} title="Kaldır">
                    <Trash2 className="size-4" />
                  </Button>
                  {t.flowKey && (
                    <div className="flex basis-full flex-wrap items-center gap-2 pl-12 text-xs text-muted">
                      <KeyRound className="size-3.5" /> Akış anahtarı <CopyCommand value={t.flowKey} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <AddTargetModal open={adding} onClose={() => setAdding(false)} onAdded={update} />
      <TestPeopleModal
        key={testing?.id ?? "none"}
        target={testing}
        contacts={contacts}
        sending={test.isPending}
        onClose={() => setTesting(null)}
        onSend={(contactIds) => testing && test.mutate({ id: testing.id, contactIds })}
      />
    </Section>
  );
}

function AddTargetModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (s: ClientSettings) => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<TeamsTargetKind>("channel");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const add = useMutation({
    mutationFn: () => api<{ settings: ClientSettings }>("/api/teams/targets", { method: "POST", json: { name, kind, url } }),
    onSuccess: (d) => {
      onAdded(d.settings);
      setName("");
      setUrl("");
      onClose();
      toast({
        tone: "success",
        title: "Hedef eklendi",
        description: kind === "people" ? "Akış anahtarını akıştaki koşula yazıp deneme kartı gönderin." : "Deneme kartı göndererek doğrulayın.",
      });
    },
    onError: (e) => toast({ tone: "error", title: "Eklenemedi", description: e.message }),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Teams hedefi ekle"
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="primary" size="sm" disabled={!name.trim() || !url.trim()} loading={add.isPending} onClick={() => add.mutate()}>
            <Plus className="size-4" /> Ekle
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Tür">
          {(Object.keys(TEAMS_TARGET_KINDS) as TeamsTargetKind[]).map((k) => {
            const Icon = KIND_META[k].icon;
            const on = kind === k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setKind(k)}
                className={cn(
                  "flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors",
                  on ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong",
                )}
              >
                <Icon className={cn("mt-0.5 size-4 shrink-0", on ? "text-accent-text" : "text-subtle")} />
                <span>
                  <span className="block text-sm font-semibold">{TEAMS_TARGET_KINDS[k]}</span>
                  <span className="block text-xs text-muted">{KIND_META[k].hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="rounded-xl bg-surface-2 p-4 text-xs text-muted [&_strong]:text-text">
          <p className="mb-2 text-[13px] font-medium text-text">Teams&apos;te yapılacaklar</p>
          <KindSteps kind={kind} />
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
          <Field label="Ad" htmlFor="t-name">
            <Input id="t-name" placeholder={KIND_META[kind].placeholder} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Webhook adresi" htmlFor="t-url">
            <Input id="t-url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function TestPeopleModal({
  target,
  contacts,
  sending,
  onClose,
  onSend,
}: {
  target: PublicTeamsTarget | null;
  contacts: TeamsContact[];
  sending: boolean;
  onClose: () => void;
  onSend: (contactIds: string[]) => void;
}) {
  const [ids, setIds] = useState<string[]>([]);
  const valid = validContactIds(contacts, ids);
  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title="Deneme kartı gönder"
      size="sm"
      footer={
        <Button variant="primary" size="sm" disabled={!valid.length} loading={sending} onClick={() => onSend(valid)}>
          <Send className="size-4" /> Gönder
        </Button>
      }
    >
      <p className="mb-3 text-sm text-muted">Kime gitsin? (en fazla {MAX_TEAMS_TEST_RECIPIENTS} kişi)</p>
      <RecipientPicker contacts={contacts} value={ids} onChange={setIds} max={MAX_TEAMS_TEST_RECIPIENTS} />
    </Modal>
  );
}

function ContactsSection({ contacts }: { contacts: TeamsContact[] }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const update = (s: ClientSettings) => queryClient.setQueryData<SettingsResponse>(qk.settings, (old) => (old ? { ...old, settings: s } : old));

  const add = useMutation({
    mutationFn: () => api<{ settings: ClientSettings }>("/api/teams/contacts", { method: "POST", json: { name, email } }),
    onSuccess: (d) => {
      update(d.settings);
      setName("");
      setEmail("");
    },
    onError: (e) => toast({ tone: "error", title: "Eklenemedi", description: e.message }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<{ settings: ClientSettings }>(`/api/teams/contacts/${id}`, { method: "DELETE" }),
    onSuccess: (d) => update(d.settings),
    onError: (e) => toast({ tone: "error", title: "Silinemedi", description: e.message }),
  });

  return (
    <Section
      icon={Users}
      title="Kişiler"
      help={
        <>
          <p>
            <strong>Kişiler</strong> türündeki hedefe gönderirken bu listeden seçim yaparsınız (bir seferde en fazla {MAX_TEAMS_RECIPIENTS} kişi).
          </p>
          <p>E-posta, kişinin Teams&apos;te kullandığı kurumsal adres olmalı. Kanal ve sohbet hedefleri bu listeyi kullanmaz.</p>
        </>
      }
    >
      <div className="space-y-4 p-5">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Input aria-label="Ad" placeholder="Ad Soyad" value={name} onChange={(e) => setName(e.target.value)} className="sm:w-56" />
          <Input aria-label="E-posta" type="email" placeholder="e-posta@sirket.com" value={email} onChange={(e) => setEmail(e.target.value)} className="flex-1" />
          <Button type="submit" variant="primary" disabled={!name.trim() || !email.trim()} loading={add.isPending}>
            <Plus className="size-4" /> Ekle
          </Button>
        </form>
        {contacts.length === 0 ? (
          <Empty>Henüz kişi yok.</Empty>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {contacts.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                <Avatar name={c.name} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="truncate text-xs text-subtle">{c.email}</p>
                </div>
                <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => remove.mutate(c.id)} title="Kaldır">
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

// ── Tercihler ────────────────────────────────────────────────────────────────

function DaysInput({ id, value, max, onChange }: { id: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        min={1}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(1, Math.min(max, Number(e.target.value) || 1)))}
        className="w-24"
      />
      <span className="text-sm text-muted">gün</span>
    </div>
  );
}

function PreferencesSection({ value, onChange }: { value: Draft["preferences"]; onChange: (v: Draft["preferences"]) => void }) {
  return (
    <Section
      icon={SlidersHorizontal}
      title="Tercihler"
      help={
        <>
          <p>
            <strong>Testte bekleme uyarısı:</strong> bir madde bu kadar günden uzun testte kalırsa uyarı alır.
          </p>
          <p>
            <strong>Yaklaşan release:</strong> bu kadar gün içinde çıkacak release&apos;ler vurgulanır.
          </p>
          <p>
            Tüm ayarlar ve kayıtlar bu bilgisayarda, proje klasöründeki <strong>data/</strong> içinde tutulur.
          </p>
        </>
      }
    >
      <div className="grid gap-5 p-5 sm:grid-cols-2">
        <Field label="Testte bekleme uyarısı" htmlFor="p-stale">
          <DaysInput id="p-stale" value={value.staleTestDays} max={90} onChange={(staleTestDays) => onChange({ ...value, staleTestDays })} />
        </Field>
        <Field label="Yaklaşan release" htmlFor="p-soon">
          <DaysInput id="p-soon" value={value.releaseSoonDays} max={60} onChange={(releaseSoonDays) => onChange({ ...value, releaseSoonDays })} />
        </Field>
      </div>
    </Section>
  );
}
