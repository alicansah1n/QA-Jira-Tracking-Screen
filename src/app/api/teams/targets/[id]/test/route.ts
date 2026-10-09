import { z } from "zod";
import { readJsonBody } from "@/lib/server/body";
import { getContext } from "@/lib/server/context";
import { AppError, handle } from "@/lib/server/respond";
import { TeamsContactIdsSchema } from "@/domain/settings/schema";
import { testCard } from "@/lib/teams/cards";
import { deliverTeamsCard, resolveTeamsTarget } from "@/lib/teams/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hedefe deneme kartı gönderir. */
export async function POST(request: Request, ctx: RouteContext<"/api/teams/targets/[id]/test">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!/^[a-z0-9-]{6,40}$/.test(id)) throw new AppError(400, "BAD_REQUEST", "Geçersiz kimlik");
    const { contactIds } = z.object({ contactIds: TeamsContactIdsSchema, confirm: z.literal(true) }).parse(await readJsonBody(request, 8 * 1024));
    const c = getContext();
    const resolved = resolveTeamsTarget(await c.settings.read(), { targetId: id, contactIds }, { test: true });
    const me = await c.myself().catch(() => undefined);
    await deliverTeamsCard(resolved, testCard(me?.displayName ?? "QA Asistanı"));
    return Response.json({ ok: true });
  });
}
