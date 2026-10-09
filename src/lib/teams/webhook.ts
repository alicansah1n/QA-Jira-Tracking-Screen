import "server-only";

/**
 * Teams Workflows (Power Automate) webhook'u. Adres imzalı bir sırdır; yalnızca Microsoft'un bilinen
 * alan adlarına gönderilir, yönlendirme izlenmez ve Jira istemcisinden tamamen ayrıdır.
 */
const ALLOWED_HOST_SUFFIXES = [".webhook.office.com", ".logic.azure.com", ".powerplatform.com", ".powerautomate.com"];

export function validateWebhookUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "Geçerli bir adres değil" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "Adres https ile başlamalı" };
  if (url.username || url.password) return { ok: false, reason: "Adreste kullanıcı bilgisi olamaz" };
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: "Teams Workflows / Power Automate webhook adresi olmalı" };
  }
  return { ok: true, url };
}

export type AdaptiveCard = { type: "AdaptiveCard"; version: string; body: unknown[]; actions?: unknown[]; $schema?: string; msteams?: unknown };

export class TeamsError extends Error {
  // Next aynı modülü farklı paketlerde (sayfa / route) ayrı kopyalar olarak yükleyebilir; o zaman
  // `instanceof` kopyalar arasında tutmaz. Kontrol sınıf adına göre yapılır.
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null && (value as { name?: unknown }).name === "TeamsError";
  }

  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "TeamsError";
  }
}

/**
 * Kartı webhook'a gönderir. `recipients` verilirse gövdeye eklenir; "Kişiler" akışı bu listedeki her
 * adrese kartı ayrı ayrı iletir (kanal/sohbet şablonları bu alanı yok sayar).
 */
export async function sendTeamsCard(
  rawUrl: string,
  card: AdaptiveCard,
  { recipients, flowKey, fetchImpl = fetch }: { recipients?: string[]; flowKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<void> {
  const check = validateWebhookUrl(rawUrl);
  if (!check.ok) throw new TeamsError(check.reason);
  let response: Response;
  try {
    response = await fetchImpl(check.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(flowKey ? { "x-qa-key": flowKey } : {}) },
      body: JSON.stringify({
        type: "message",
        attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null, content: card }],
        ...(recipients?.length ? { recipients } : {}),
      }),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new TeamsError("Teams'e ulaşılamadı. Ağ/VPN bağlantınızı kontrol edin.");
  }
  await response.body?.cancel().catch(() => undefined);
  // Workflows "202 Accepted" döner: kabul edildi demektir, teslim garantisi değildir.
  if (!response.ok) {
    const hint =
      response.status === 401 || response.status === 403
        ? "Webhook yetkisiz; akış silinmiş ya da adres değişmiş olabilir."
        : response.status === 404
          ? "Webhook bulunamadı; adresi kontrol edin."
          : "Teams isteği reddetti.";
    throw new TeamsError(`${hint} (HTTP ${response.status})`, response.status);
  }
}
