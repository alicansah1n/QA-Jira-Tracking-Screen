import { CloseInputSchema, planClose } from "@/domain/issue-close/service";
import { readJsonBody } from "@/lib/server/body";
import { getContext } from "@/lib/server/context";
import { handle, issueKeyParam } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Salt okuma: seçimlere göre yapılacakları ve engelleri hesaplar (önizleme). */
export async function POST(request: Request, ctx: RouteContext<"/api/issues/[key]/close/plan">) {
  return handle(async () => {
    const key = issueKeyParam((await ctx.params).key);
    const input = CloseInputSchema.parse(await readJsonBody(request, 64 * 1024));
    return Response.json(await planClose(getContext(), key, input));
  });
}
