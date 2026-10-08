import { z } from "zod";
import { rollbackInterrupted } from "@/domain/release-close/executor";
import { readJsonBody } from "@/lib/server/body";
import { getContext } from "@/lib/server/context";
import { AppError, handle } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Input = z.object({ confirm: z.literal(true) });

/** Yarıda kalmış kapatmayı geri alır (çalışmakta olan bir kapatmaya dokunmaz). */
export async function POST(request: Request, ctx: RouteContext<"/api/release-close/journals/[runId]/rollback">) {
  return handle(async () => {
    const { runId } = await ctx.params;
    if (!/^[a-z0-9-]{8,64}$/.test(runId)) throw new AppError(400, "BAD_REQUEST", "Geçersiz kimlik");
    Input.parse(await readJsonBody(request, 1024));
    const c = getContext();
    await c.myself();
    return Response.json({ journal: await rollbackInterrupted(c, runId) });
  });
}
