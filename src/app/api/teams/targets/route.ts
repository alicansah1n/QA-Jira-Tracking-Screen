import { randomBytes } from "node:crypto";
import { z } from "zod";
import { DisplayNameSchema, MAX_TEAMS_TARGETS, TeamsTargetKindSchema } from "@/domain/settings/schema";
import { readJsonBody } from "@/lib/server/body";
import { getContext } from "@/lib/server/context";
import { publicSettings } from "@/lib/server/public-settings";
import { AppError, handle } from "@/lib/server/respond";
import { validateWebhookUrl } from "@/lib/teams/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Input = z.object({
  name: DisplayNameSchema,
  kind: TeamsTargetKindSchema.default("channel"),
  url: z.string().trim().min(1).max(2000),
});

/** Yeni Teams hedefi (kanal, sohbet ya da kişiler akışının webhook'u) ekler. */
export async function POST(request: Request) {
  return handle(async () => {
    const input = Input.parse(await readJsonBody(request, 8 * 1024));
    const check = validateWebhookUrl(input.url);
    if (!check.ok) throw new AppError(422, "INVALID_URL", check.reason);
    const id = `t-${randomBytes(5).toString("hex")}`;
    const flowKey = input.kind === "people" ? randomBytes(16).toString("hex") : undefined;
    const saved = await getContext().settings.update((s) => {
      if (s.teams.targets.length >= MAX_TEAMS_TARGETS) throw new AppError(422, "LIMIT", `En fazla ${MAX_TEAMS_TARGETS} Teams hedefi eklenebilir.`);
      const target = { id, name: input.name, kind: input.kind, url: check.url.toString(), ...(flowKey ? { flowKey } : {}) };
      return { ...s, teams: { ...s.teams, targets: [...s.teams.targets, target] } };
    });
    return Response.json({ settings: publicSettings(saved), id }, { status: 201 });
  });
}
