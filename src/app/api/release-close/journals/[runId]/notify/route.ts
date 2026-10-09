import { z } from "zod";
import { TeamsContactIdsSchema } from "@/domain/settings/schema";
import { notifyRelease } from "@/domain/release-close/executor";
import { readJsonBody } from "@/lib/server/body";
import { getContext } from "@/lib/server/context";
import { AppError, handle } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Input = z.object({ targetId: z.string().regex(/^[a-z0-9-]{6,40}$/), contactIds: TeamsContactIdsSchema, confirm: z.literal(true) });

/** Tamamlanmış kapatmayı Teams'e (yeniden) bildirir. */
export async function POST(request: Request, ctx: RouteContext<"/api/release-close/journals/[runId]/notify">) {
  return handle(async () => {
    const { runId } = await ctx.params;
    if (!/^[a-z0-9-]{8,64}$/.test(runId)) throw new AppError(400, "BAD_REQUEST", "Geçersiz kimlik");
    const { targetId, contactIds } = Input.parse(await readJsonBody(request, 8 * 1024));
    return Response.json({ journal: await notifyRelease(getContext(), runId, { targetId, contactIds }) });
  });
}
