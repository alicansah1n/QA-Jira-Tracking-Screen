import { z } from "zod";
import { readJsonBody } from "@/lib/server/body";
import { getContext } from "@/lib/server/context";
import { AppError, handle } from "@/lib/server/respond";
import { testCard } from "@/lib/teams/cards";
import { sendTeamsCard } from "@/lib/teams/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hedefe deneme kartı gönderir. */
export async function POST(request: Request, ctx: RouteContext<"/api/teams/targets/[id]/test">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!/^[a-z0-9-]{6,40}$/.test(id)) throw new AppError(400, "BAD_REQUEST", "Geçersiz kimlik");
    z.object({ confirm: z.literal(true) }).parse(await readJsonBody(request, 1024));
    const c = getContext();
    const target = (await c.settings.read()).teams.targets.find((t) => t.id === id);
    if (!target) throw new AppError(404, "NOT_FOUND", "Teams hedefi bulunamadı");
    const me = await c.myself().catch(() => undefined);
    await sendTeamsCard(target.url, testCard(me?.displayName ?? "QA Asistanı"));
    return Response.json({ ok: true });
  });
}
