import { getContext } from "@/lib/server/context";
import { publicSettings } from "@/lib/server/public-settings";
import { AppError, handle } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_: Request, ctx: RouteContext<"/api/teams/targets/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!/^[a-z0-9-]{6,40}$/.test(id)) throw new AppError(400, "BAD_REQUEST", "Geçersiz kimlik");
    const saved = await getContext().settings.update((s) => ({ ...s, teams: { ...s.teams, targets: s.teams.targets.filter((t) => t.id !== id) } }));
    return Response.json({ settings: publicSettings(saved) });
  });
}
