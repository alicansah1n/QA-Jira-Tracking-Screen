"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, BellRing, CheckCircle2, CircleAlert, FileCode2, MessageSquareText, PenLine, ShieldCheck, Workflow, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { RecipientPicker, validContactIds } from "@/components/recipient-picker";
import { ErrorPanel } from "@/components/states";
import { Badge, Button, ButtonLink, Card, CardHeader, Checkbox, cn, Field, Input, LoadingRows, Notice, Select, Stepper, Textarea } from "@/components/ui";
import type { ClosePlan, StepResult } from "@/domain/issue-close/service";
import { teamsTargetLabel, type TeamsContact } from "@/domain/settings/schema";
import { VERDICT_LABELS, type RunSummary } from "@/domain/testrun/schema";
import { api } from "@/lib/client/api";
import { qk, type PublicTeamsTarget } from "@/lib/client/queries";

type Defaults = {
  me: { accountId: string; displayName: string };
  transitions: { id: string; name: string; to: string; toCategory?: string }[];
  defaultComment: string;
  summary: RunSummary;
  closedAt: string | null;
  fieldsMapped: { testAssignee: boolean; storyPointTest: boolean };
  teamsTargets: Omit<PublicTeamsTarget, "url">[];
  teamsContacts: TeamsContact[];
};

type Form = {
  reclose: boolean;
  setTestAssignee: boolean;
  storyPointTest: string;
  addComment: boolean;
  comment: string;
  attachReport: boolean;
  transitionId: string;
  teamsTargetId: string;
  teamsContactIds: string[];
};

type ExecuteResult = { results: StepResult[]; completed: boolean; plan: ClosePlan; teams?: { ok: boolean; message?: string } };

const STEP_ICON = { attach: FileCode2, comment: MessageSquareText, fields: PenLine, transition: Workflow } as const;

export function CloseWizard({ issueKey }: { issueKey: string }) {
  const queryClient = useQueryClient();
  const defaults = useQuery({
    queryKey: ["close-defaults", issueKey],
    queryFn: () => api<Defaults>(`/api/issues/${issueKey}/close`),
    // Varsayılan yorum test sonuçlarından üretilir; her açılışta taze olmalı.
    staleTime: 0,
    refetchOnMount: "always",
  });
  const [form, setForm] = useState<Form | null>(null);
  const [step, setStep] = useState(0);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const d = defaults.data;
    if (!d || form) return;
    const done = d.transitions.find((t) => t.toCategory === "done");
    setForm({
      setTestAssignee: d.fieldsMapped.testAssignee,
      storyPointTest: "",
      addComment: true,
      comment: d.defaultComment,
      attachReport: true,
      transitionId: done?.id ?? "",
      teamsTargetId: "",
      teamsContactIds: [],
      reclose: false,
    });
  }, [defaults.data, form]);

  const input = () => {
    const d = defaults.data!;
    const f = form!;
    const sp = f.storyPointTest.trim() === "" ? null : Number(f.storyPointTest.replace(",", "."));
    return {
      testAssignee: f.setTestAssignee ? d.me : null,
      storyPointTest: sp !== null && Number.isFinite(sp) ? sp : null,
      comment: f.addComment ? f.comment : "",
      attachReport: f.attachReport,
      transitionId: f.transitionId || null,
      teamsTargetId: f.teamsTargetId || null,
      teamsContactIds: d.teamsTargets.find((t) => t.id === f.teamsTargetId)?.kind === "people" ? validContactIds(d.teamsContacts, f.teamsContactIds) : [],
      reclose: f.reclose,
    };
  };

  const plan = useMutation({ mutationFn: () => api<ClosePlan>(`/api/issues/${issueKey}/close/plan`, { method: "POST", json: input() }) });
  const execute = useMutation({
    mutationFn: () => api<ExecuteResult>(`/api/issues/${issueKey}/close`, { method: "POST", json: { ...input(), confirm: true } }),
    onSuccess: () => {
      setStep(2);
      queryClient.invalidateQueries({ queryKey: qk.run(issueKey) });
      queryClient.invalidateQueries({ queryKey: qk.inbox });
    },
  });

  if (defaults.isPending) return <Card><LoadingRows rows={5} /></Card>;
  if (defaults.isError) return <ErrorPanel error={defaults.error} />;
  if (!form) return null;
  const d = defaults.data;
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const selectedTarget = d?.teamsTargets.find((t) => t.id === form.teamsTargetId);
  const peopleTarget = selectedTarget?.kind === "people";
  const selectedContacts = peopleTarget ? d.teamsContacts.filter((c) => form.teamsContactIds.includes(c.id)) : [];
  const spInvalid = form.storyPointTest.trim() !== "" && !Number.isFinite(Number(form.storyPointTest.replace(",", ".")));

  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <Stepper steps={["Bilgiler", "Önizleme ve onay", "Sonuç"]} current={step} />
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted">Test sonucu:</span>
          <Badge tone={d.summary.verdict === "passed" ? "success" : d.summary.verdict === "failed" ? "danger" : d.summary.verdict === "blocked" ? "warning" : "info"} dot>
            {VERDICT_LABELS[d.summary.verdict]}
          </Badge>
          <span className="text-xs text-subtle">
            {d.summary.done}/{d.summary.total} case
          </span>
        </div>
      </Card>

      {d.closedAt && step < 2 && (
        <Notice tone="warning" title="Bu madde daha önce bu uygulamadan kapatılmış">
          <Checkbox
            label="Tekrar kapat"
            description="Rapor ve yorum yeniden eklenir. Yalnızca bilerek tekrar yapmak istiyorsanız işaretleyin."
            checked={form.reclose}
            onChange={(e) => set({ reclose: e.target.checked })}
          />
        </Notice>
      )}
      {d.summary.counts.pending > 0 && step === 0 && (
        <Notice tone="warning" title={`${d.summary.counts.pending} case henüz işaretlenmedi`} icon={CircleAlert}>
          Yine de devam edebilirsiniz; rapor ve yorumda &quot;Bekliyor&quot; olarak görünürler.
        </Notice>
      )}

      {step === 0 && (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader icon={MessageSquareText} title="Özet yorum" description="Maddeye sizin adınıza eklenecek. Düzenleyebilirsiniz." />
            <div className="space-y-3 p-5">
              <Checkbox label="Özet yorum ekle" checked={form.addComment} onChange={(e) => set({ addComment: e.target.checked })} />
              <Textarea rows={12} value={form.comment} disabled={!form.addComment} onChange={(e) => set({ comment: e.target.value })} className="font-[family-name:var(--font-sans)]" />
            </div>
          </Card>
          <div className="space-y-6">
            <Card>
              <CardHeader icon={PenLine} title="Alanlar" />
              <div className="space-y-4 p-5">
                <Checkbox
                  label={`Test Assignee → ${d.me.displayName}`}
                  description={d.fieldsMapped.testAssignee ? "Testçi alanına siz yazılırsınız." : "Alan Ayarlar'da eşlenmemiş."}
                  checked={form.setTestAssignee}
                  disabled={!d.fieldsMapped.testAssignee}
                  onChange={(e) => set({ setTestAssignee: e.target.checked })}
                />
                <Field label="StoryPointTest" hint={d.fieldsMapped.storyPointTest ? "Boş bırakırsanız değiştirilmez." : "Alan Ayarlar'da eşlenmemiş."} htmlFor="sp">
                  <Input
                    id="sp"
                    inputMode="decimal"
                    placeholder="ör. 3"
                    value={form.storyPointTest}
                    disabled={!d.fieldsMapped.storyPointTest}
                    onChange={(e) => set({ storyPointTest: e.target.value })}
                    className={cn(spInvalid && "border-danger")}
                  />
                </Field>
                <Checkbox label="HTML sonuç raporunu ek olarak yükle" checked={form.attachReport} onChange={(e) => set({ attachReport: e.target.checked })} />
              </div>
            </Card>
            <Card>
              <CardHeader icon={Workflow} title="Statü ve bildirim" />
              <div className="space-y-4 p-5">
                <Field label="Statü geçişi" htmlFor="tr">
                  <Select id="tr" value={form.transitionId} onChange={(e) => set({ transitionId: e.target.value })}>
                    <option value="">Statüyü değiştirme</option>
                    {d.transitions.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} → {t.to}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Teams bildirimi" hint={d.teamsTargets.length ? undefined : "Ayarlar'dan Teams hedefi ekleyebilirsiniz."} htmlFor="tm">
                  <Select id="tm" value={form.teamsTargetId} disabled={!d.teamsTargets.length} onChange={(e) => set({ teamsTargetId: e.target.value })}>
                    <option value="">Bildirim gönderme</option>
                    {d.teamsTargets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {teamsTargetLabel(t)}
                      </option>
                    ))}
                  </Select>
                </Field>
                {peopleTarget && (
                  <RecipientPicker contacts={d.teamsContacts} value={form.teamsContactIds} onChange={(ids) => set({ teamsContactIds: ids })} />
                )}
              </div>
            </Card>
            <div className="flex justify-end gap-2">
              <ButtonLink href={`/tests/${issueKey}`} variant="ghost">
                Vazgeç
              </ButtonLink>
              <Button
                variant="primary"
                disabled={spInvalid || (peopleTarget && !selectedContacts.length)}
                loading={plan.isPending}
                onClick={() =>
                  plan.mutate(undefined, {
                    onSuccess: () => {
                      setConfirmed(false);
                      setStep(1);
                    },
                  })
                }
              >
                Önizle <ArrowRight className="size-4" />
              </Button>
            </div>
            {plan.isError && <ErrorPanel error={plan.error} />}
          </div>
        </div>
      )}

      {step === 1 && plan.data && (
        <Card className="mx-auto max-w-3xl">
          <CardHeader icon={ShieldCheck} title="Jira'da yapılacaklar" description="Onayladığınızda sırayla uygulanır. Bir adım başarısız olursa sonraki adımlar yapılmaz." />
          <ol className="divide-y divide-border">
            {plan.data.steps.map((s, i) => {
              const Icon = STEP_ICON[s.kind];
              return (
                <li key={s.kind} className="flex items-start gap-4 px-5 py-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-text">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {i + 1}. {s.title}
                    </p>
                    <p className="text-[13px] text-muted">{s.detail}</p>
                  </div>
                </li>
              );
            })}
            {input().teamsTargetId && (
              <li className="flex items-start gap-4 px-5 py-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-info-soft text-info">
                  <BellRing className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold">Teams bildirimi</p>
                  <p className="text-[13px] text-muted">{selectedTarget && teamsTargetLabel(selectedTarget)}
                    {selectedContacts.length > 0 && ` (${selectedContacts.map((c) => c.name).join(", ")})`} — Jira işlemleri başarılı olursa</p>
                </div>
              </li>
            )}
          </ol>
          <div className="space-y-4 border-t border-border p-5">
            {plan.data.blockers.length > 0 ? (
              <Notice tone="danger" title="Bu haliyle uygulanamaz" icon={XCircle}>
                <ul className="list-inside list-disc">
                  {plan.data.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </Notice>
            ) : (
              <Checkbox
                label="Yukarıdaki değişikliklerin Jira'da benim adıma yapılmasını onaylıyorum"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
            )}
            {execute.isError && <ErrorPanel error={execute.error} />}
            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep(0)}>
                <ArrowLeft className="size-4" /> Geri
              </Button>
              <Button variant="primary" disabled={!confirmed || plan.data.blockers.length > 0} loading={execute.isPending} onClick={() => execute.mutate()}>
                Onayla ve uygula
              </Button>
            </div>
          </div>
        </Card>
      )}

      {step === 2 && execute.data && <ResultCard issueKey={issueKey} result={execute.data} />}
    </div>
  );
}

function ResultCard({ issueKey, result }: { issueKey: string; result: ExecuteResult }) {
  return (
    <Card className="mx-auto max-w-3xl overflow-hidden">
      <div className={cn("px-6 py-6 text-white", result.completed ? "bg-success" : "bg-danger")}>
        <div className="flex items-center gap-3">
          {result.completed ? <CheckCircle2 className="size-7" /> : <XCircle className="size-7" />}
          <div>
            <h2 className="text-xl font-semibold">{result.completed ? "Madde kapatıldı" : "İşlem yarıda kaldı"}</h2>
            <p className="text-sm text-white/85">{result.completed ? "Tüm adımlar başarıyla uygulandı." : "Aşağıda hangi adımların yapıldığını görebilirsiniz."}</p>
          </div>
        </div>
      </div>
      {result.results.length === 0 && result.plan.blockers.length > 0 && (
        <div className="p-6">
          <Notice tone="danger" title="Önizlemeden sonra durum değişti; hiçbir şey yapılmadı" icon={XCircle}>
            <ul className="list-inside list-disc">
              {result.plan.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Notice>
        </div>
      )}
      <ul className="divide-y divide-border">
        {result.results.map((r) => (
          <li key={r.kind} className="flex items-start gap-3 px-6 py-3.5 text-sm">
            {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
            <span className={cn(!r.ok && "text-danger")}>{r.message}</span>
          </li>
        ))}
        {result.teams && (
          <li className="flex items-start gap-3 px-6 py-3.5 text-sm">
            {result.teams.ok ? <CheckCircle2 className="mt-0.5 size-4 text-success" /> : <XCircle className="mt-0.5 size-4 text-danger" />}
            <span>{result.teams.ok ? "Teams'e bildirildi" : `Teams bildirimi gönderilemedi: ${result.teams.message}`}</span>
          </li>
        )}
      </ul>
      <div className="flex justify-end gap-2 border-t border-border p-4">
        <ButtonLink href={`/tests/${issueKey}`}>Teste dön</ButtonLink>
        <ButtonLink href="/inbox" variant="primary">
          Gelen kutusu
        </ButtonLink>
      </div>
    </Card>
  );
}
