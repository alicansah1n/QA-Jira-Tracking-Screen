import { PreferencesSchema, SettingsSchema } from "@/domain/settings/schema";
import { loadEnv } from "@/lib/config/env";
import { readJsonBody } from "@/lib/server/body";
import { getContext } from "@/lib/server/context";
import { publicSettings } from "@/lib/server/public-settings";
import { handle } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ortam durumu (sır değerleri olmadan) ve kayıtlı ayarlar. */
export async function GET() {
  const env = loadEnv();
  if (!env.ok) return Response.json({ env: { ok: false, issues: env.issues }, settings: null });
  return handle(async () => {
    const settings = await getContext().settings.read();
    return Response.json({
      env: { ok: true, jiraBaseUrl: env.env.JIRA_BASE_URL, jiraEmail: env.env.JIRA_EMAIL },
      settings: publicSettings(settings),
    });
  });
}

/** Teams hedefleri ayrı uçtan yönetilir; burada alan, proje ve tercihler kaydedilir. */
const SettingsInputSchema = SettingsSchema.pick({ fields: true, projects: true }).extend({ preferences: PreferencesSchema });

export async function PUT(request: Request) {
  return handle(async () => {
    const input = SettingsInputSchema.parse(await readJsonBody(request, 128 * 1024));
    const saved = await getContext().settings.update((cur) => ({ ...cur, ...input, updatedAt: new Date().toISOString() }));
    return Response.json({ settings: publicSettings(saved) });
  });
}
