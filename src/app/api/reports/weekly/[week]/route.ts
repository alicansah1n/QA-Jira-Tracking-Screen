import { z } from "zod";
import { saveWeek } from "@/domain/weekly/service";
import { MAX_NOTE_LENGTH } from "@/domain/weekly/store";
import { readJsonBody } from "@/lib/server/body";
import { getContext } from "@/lib/server/context";
import { handle, weekParam } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Input = z.object({ note: z.string().max(MAX_NOTE_LENGTH) });

/** Haftanın notunu ve sayılarını uygulamaya kaydeder (Jira'ya yazmaz). */
export async function PUT(request: Request, ctx: RouteContext<"/api/reports/weekly/[week]">) {
  return handle(async () => {
    const week = weekParam((await ctx.params).week);
    const { note } = Input.parse(await readJsonBody(request, 32 * 1024));
    return Response.json({ saved: await saveWeek(getContext(), week, note) });
  });
}
