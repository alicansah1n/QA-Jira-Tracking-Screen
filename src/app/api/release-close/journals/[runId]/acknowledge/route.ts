import { z } from "zod";
import { acknowledgeJournal } from "@/domain/release-close/executor";
import { readJsonBody } from "@/lib/server/body";
import { getContext } from "@/lib/server/context";
import { AppError, handle } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Input = z.object({ confirm: z.literal(true) });

/** Geri alması eksik kalan kaydı, kullanıcı Jira'yı elle düzelttiğini onaylayınca kapatır. */
export async function POST(request: Request, ctx: RouteContext<"/api/release-close/journals/[runId]/acknowledge">) {
  return handle(async () => {
    const { runId } = await ctx.params;
    if (!/^[a-z0-9-]{8,64}$/.test(runId)) throw new AppError(400, "BAD_REQUEST", "Geçersiz kimlik");
    Input.parse(await readJsonBody(request, 1024));
    return Response.json({ journal: await acknowledgeJournal(getContext(), runId) });
  });
}
