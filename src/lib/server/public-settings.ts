import "server-only";
import { maskWebhookUrl, type Settings } from "@/domain/settings/schema";

/** Teams adresleri imzalı sırdır; istemciye yalnızca maskelenmiş hali gider. */
export function publicSettings(s: Settings) {
  return { ...s, teams: { targets: s.teams.targets.map((t) => ({ id: t.id, name: t.name, url: maskWebhookUrl(t.url) })) } };
}

export type PublicSettings = ReturnType<typeof publicSettings>;
