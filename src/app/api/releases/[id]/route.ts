import { getReleaseDetail } from "@/domain/releases/service";
import { getAnalysisStore, getContext } from "@/lib/server/context";
import { handle, idParam } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: RouteContext<"/api/releases/[id]">) {
  return handle(async () => {
    const id = idParam((await ctx.params).id);
    return Response.json(await getReleaseDetail(getContext(), id, getAnalysisStore()));
  });
}
