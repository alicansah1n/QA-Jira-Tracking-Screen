import "server-only";
import { MAX_TEAMS_RECIPIENTS, MAX_TEAMS_TEST_RECIPIENTS, type Settings, type TeamsContact, type TeamsTarget } from "@/domain/settings/schema";
import { sendTeamsCard, type AdaptiveCard } from "./webhook";

/** Seçilen hedef/kişiler gönderime uygun değil. Jira'ya dokunmadan önce yakalanması için ayrı sınıf. */
export class TeamsTargetError extends Error {
  // Next aynı modülü farklı paketlerde ayrı kopyalar olarak yükleyebilir; kontrol sınıf adına göre yapılır.
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null && (value as { name?: unknown }).name === "TeamsTargetError";
  }

  constructor(message: string) {
    super(message);
    this.name = "TeamsTargetError";
  }
}

export type TeamsSelection = { targetId: string; contactIds: string[] };
export type ResolvedTeamsTarget = { target: TeamsTarget; recipients: TeamsContact[] };

/**
 * Hedefi ve (Kişiler hedefi için) alıcıları ayarlardan çözer. Alıcılar yalnızca kayıtlı kişi listesinden
 * seçilebilir; istemciden gelen serbest e-posta adresine gönderilmez.
 */
export function resolveTeamsTarget(settings: Settings, selection: TeamsSelection, { test = false } = {}): ResolvedTeamsTarget {
  const target = settings.teams.targets.find((t) => t.id === selection.targetId);
  if (!target) throw new TeamsTargetError("Teams hedefi bulunamadı. Ayarlar'dan kontrol edin.");
  if (target.kind !== "people") return { target, recipients: [] };

  const ids = [...new Set(selection.contactIds)];
  if (!ids.length) throw new TeamsTargetError("Kişiler hedefi için en az bir kişi seçin.");
  const max = test ? MAX_TEAMS_TEST_RECIPIENTS : MAX_TEAMS_RECIPIENTS;
  if (ids.length > max) throw new TeamsTargetError(test ? `Deneme kartı en fazla ${max} kişiye gönderilebilir.` : `Bir gönderimde en fazla ${max} kişi seçilebilir.`);
  const recipients = ids.map((id) => settings.teams.contacts.find((c) => c.id === id));
  if (recipients.some((c) => !c)) throw new TeamsTargetError("Seçilen kişilerden biri kişi listesinde yok. Sayfayı yenileyin.");
  return { target, recipients: recipients as TeamsContact[] };
}

export function deliverTeamsCard({ target, recipients }: ResolvedTeamsTarget, card: AdaptiveCard): Promise<void> {
  return sendTeamsCard(target.url, card, { recipients: recipients.map((r) => r.email), flowKey: target.flowKey });
}
