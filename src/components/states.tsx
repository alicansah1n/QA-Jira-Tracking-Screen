"use client";

import { FolderPlus, KeyRound, PlugZap, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { ApiRequestError } from "@/lib/client/api";
import { ButtonLink, Card, EmptyState, Kbd, Notice } from "./ui";

/** `.env.local` eksikse gösterilen kurulum yönergesi. */
export function EnvMissing({ issues }: { issues?: { key: string; message: string }[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="brand-grad px-6 py-5 text-white">
        <div className="flex items-center gap-3">
          <KeyRound className="size-5" aria-hidden />
          <h2 className="text-lg font-semibold">Jira bağlantısını kuralım</h2>
        </div>
        <p className="mt-1 text-sm text-white/85">Uygulama Jira bilgilerinizi yalnızca bu bilgisayardaki .env.local dosyasından okur.</p>
      </div>
      <ol className="space-y-4 p-6 text-sm">
        <li className="flex gap-3">
          <Step n={1} />
          <div>
            Proje klasöründe <Kbd>.env.example</Kbd> dosyasını <Kbd>.env.local</Kbd> adıyla kopyalayın.
            <p className="mt-1 text-xs text-muted">
              Gerçek değerleri <strong>.env.example</strong> içine yazmayın; o dosya git'e girer ve uygulama onu okumaz.
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <Step n={2} />
          <div>
            <Kbd>JIRA_BASE_URL</Kbd>, <Kbd>JIRA_EMAIL</Kbd> ve <Kbd>JIRA_API_TOKEN</Kbd> değerlerini doldurun.
            <p className="mt-1 text-xs text-muted">
              Token:{" "}
              <a className="text-accent-text hover:underline" href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer noopener">
                id.atlassian.com → Security → API tokens
              </a>
              . E-posta, token'ı oluşturduğunuz Atlassian hesabının e-postası olmalı.
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <Step n={3} />
          <div>
            Uygulamayı yeniden başlatın (<Kbd>npm run dev</Kbd>) ve bu sayfayı yenileyin.
          </div>
        </li>
      </ol>
      {issues && issues.length > 0 && (
        <div className="border-t border-border bg-surface-2 px-6 py-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Eksik / hatalı değerler</p>
          <ul className="flex flex-wrap gap-2">
            {issues.map((i) => (
              <li key={i.key} className="rounded-lg bg-danger-soft px-2.5 py-1 font-mono text-xs text-danger">
                {i.key}: {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Step({ n }: { n: number }) {
  return <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text">{n}</span>;
}

/** Takip edilen proje yoksa gösterilir. */
export function NoProjects({ what }: { what: string }) {
  return (
    <Card>
      <EmptyState
        icon={FolderPlus}
        title="Henüz takip edilen proje yok"
        description={`${what} için Ayarlar'dan en az bir Jira projesi ekleyin ve statü eşlemesini yapın.`}
        action={
          <ButtonLink href="/settings#projects" variant="primary">
            Proje ekle
          </ButtonLink>
        }
      />
    </Card>
  );
}

/** API hatasını anlaşılır biçimde gösterir; bağlantı hatalarında yönlendirme ekler. */
export function ErrorPanel({ error, action }: { error: unknown; action?: ReactNode }) {
  const body = error instanceof ApiRequestError ? error.body : undefined;
  const code = body?.code;
  const message = body?.message ?? (error instanceof Error ? error.message : "Beklenmeyen bir hata oluştu");
  const auth = code === "JIRA_AUTH";
  const network = code === "JIRA_NETWORK";
  const details = Array.isArray(body?.details) ? (body.details as unknown[]).filter((d): d is string => typeof d === "string") : [];
  return (
    <Notice tone="danger" title={message} icon={auth || network ? PlugZap : TriangleAlert}>
      {auth && (
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[13px]">
          <li>.env.local içindeki JIRA_EMAIL, token'ı oluşturan Atlassian hesabının e-postası mı?</li>
          <li>Token kopyalanırken eksik/fazla karakter kalmış olabilir; yenisini oluşturup deneyin.</li>
          <li>Değişiklikten sonra uygulamayı yeniden başlatın.</li>
        </ul>
      )}
      {network && <p className="text-[13px]">VPN açık mı? Şirket ağındaysanız Jira adresine tarayıcıdan erişebildiğinizi kontrol edin.</p>}
      {details.length > 0 && (
        <ul className="mt-1 list-inside list-disc text-[13px]">
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      {action && <div className="mt-3">{action}</div>}
    </Notice>
  );
}
