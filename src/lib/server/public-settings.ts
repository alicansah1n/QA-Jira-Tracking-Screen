import "server-only";
import { maskWebhookUrl, type Settings } from "@/domain/settings/schema";

/**
 * Teams adresleri imzalı sırdır; istemciye yalnızca maskelenmiş hali gider. Akış anahtarı ise kullanıcının
 * akıştaki koşula yapıştırması için gösterilir; adres olmadan tek başına işe yaramaz.
 */
export function publicSettings(s: Settings) {
  return { ...s, teams: { ...s.teams, targets: s.teams.targets.map((t) => ({ id: t.id, name: t.name, kind: t.kind, url: maskWebhookUrl(t.url), ...(t.flowKey ? { flowKey: t.flowKey } : {}) })) } };
}

export type PublicSettings = ReturnType<typeof publicSettings>;
