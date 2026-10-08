import { randomBytes } from "node:crypto";
import { z } from "zod";
import { readJsonBody } from "@/lib/server/body";
import { getContext } from "@/lib/server/context";
import { publicSettings } from "@/lib/server/public-settings";
import { AppError, handle } from "@/lib/server/respond";
import { validateWebhookUrl } from "@/lib/teams/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Input = z.object({ name: z.string().trim().min(1).max(80), url: z.string().trim().min(1).max(2000) });

/** Yeni Teams hedefi (kanal webhook'u) ekler. */
export async function POST(request: Request) {
  return handle(async () => {
    const input = Input.parse(await readJsonBody(request, 8 * 1024));
    const check = validateWebhookUrl(input.url);
    if (!check.ok) throw new AppError(422, "INVALID_URL", check.reason);
    const id = `t-${randomBytes(5).toString("hex")}`;
    const saved = await getContext().settings.update((s) => ({
      ...s,
      teams: { targets: [...s.teams.targets, { id, name: input.name, url: check.url.toString() }] },
    }));
    return Response.json({ settings: publicSettings(saved), id }, { status: 201 });
  });
}
