import { renderReport, reportFilename } from "@/domain/report/html";
import { getAnalysisStore, getContext, jiraBrowseUrl } from "@/lib/server/context";
import { AppError, handle, issueKeyParam } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Standalone HTML sonuç raporu (indirilir ya da yeni sekmede açılır). */
export async function GET(request: Request, ctx: RouteContext<"/api/runs/[key]/report">) {
  return handle(async () => {
    const key = issueKeyParam((await ctx.params).key);
    const entry = await getAnalysisStore().load(key);
    if (!entry?.ok) throw new AppError(404, "NOT_FOUND", "Bu madde için geçerli analiz yok");
    const c = getContext();
    const run = (await c.run(key).read()) ?? undefined;
    const me = await c.myself().catch(() => undefined);
    const now = new Date().toISOString();
    const html = renderReport({ analysis: entry.analysis, run, issueUrl: jiraBrowseUrl(key), tester: me?.displayName ?? "", generatedAt: now });
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'",
        ...(download ? { "Content-Disposition": `attachment; filename="${reportFilename(key, now)}"` } : {}),
      },
    });
  });
}
