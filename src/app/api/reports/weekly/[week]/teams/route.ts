import { z } from "zod";
import { TEAMS_ID_PATTERN, TeamsContactIdsSchema } from "@/domain/settings/schema";
import { sendWeekToTeams } from "@/domain/weekly/service";
import { MAX_NOTE_LENGTH } from "@/domain/weekly/store";
import { readJsonBody } from "@/lib/server/body";
import { getContext } from "@/lib/server/context";
import { handle, weekParam } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Input = z.object({
  targetId: z.string().regex(TEAMS_ID_PATTERN),
  contactIds: TeamsContactIdsSchema,
  note: z.string().max(MAX_NOTE_LENGTH),
  confirm: z.literal(true),
});

/** Haftalık raporu kullanıcının onayıyla Teams'e gönderir. */
export async function POST(request: Request, ctx: RouteContext<"/api/reports/weekly/[week]/teams">) {
  return handle(async () => {
    const week = weekParam((await ctx.params).week);
    const { targetId, contactIds, note } = Input.parse(await readJsonBody(request, 32 * 1024));
    return Response.json({ saved: await sendWeekToTeams(getContext(), week, note, { targetId, contactIds }) });
  });
}
