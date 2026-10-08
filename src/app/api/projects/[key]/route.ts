import { getProjectSetup } from "@/domain/settings/connection-check";
import { getContext } from "@/lib/server/context";
import { handle, projectKeyParam } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Projenin statüleri, eşleme önerisi ve yetkiler. */
export async function GET(_: Request, ctx: RouteContext<"/api/projects/[key]">) {
  return handle(async () => {
    const key = projectKeyParam((await ctx.params).key);
    const c = getContext();
    await c.myself();
    return Response.json(await getProjectSetup(c.jira, key));
  });
}
