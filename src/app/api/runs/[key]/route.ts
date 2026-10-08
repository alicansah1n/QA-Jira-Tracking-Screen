import { emptyRun, RunUpdateSchema, summarizeRun } from "@/domain/testrun/schema";
import { readJsonBody } from "@/lib/server/body";
import { getAnalysisStore, getContext } from "@/lib/server/context";
import { AppError, handle, issueKeyParam } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadAnalysis(key: string) {
  const entry = await getAnalysisStore().load(key);
  if (!entry) throw new AppError(404, "NOT_FOUND", "Bu madde için analiz yok");
  if (!entry.ok) throw new AppError(422, "INVALID_ANALYSIS", "Analiz dosyası geçersiz", entry.errors);
  return entry.analysis;
}

export async function GET(_: Request, ctx: RouteContext<"/api/runs/[key]">) {
  return handle(async () => {
    const key = issueKeyParam((await ctx.params).key);
    const analysis = await loadAnalysis(key);
    const run = (await getContext().run(key).read()) ?? undefined;
    return Response.json({
      run: run ?? null,
      summary: summarizeRun(analysis, run),
      analysisChanged: Boolean(run && run.analysisGeneratedAt !== analysis.generatedAt),
    });
  });
}

/** Case sonuçlarını ve ortam bilgisini kaydeder (yalnızca analizde olan case'ler). */
export async function PUT(request: Request, ctx: RouteContext<"/api/runs/[key]">) {
  return handle(async () => {
    const key = issueKeyParam((await ctx.params).key);
    const analysis = await loadAnalysis(key);
    const input = RunUpdateSchema.parse(await readJsonBody(request, 256 * 1024));
    const ids = new Set(analysis.testCases.map((t) => t.id));
    const now = new Date().toISOString();
    const saved = await getContext()
      .run(key)
      .update((cur) => {
        const base = cur ?? emptyRun(analysis, now);
        const results = { ...base.results };
        for (const [id, r] of Object.entries(input.results ?? {})) {
          if (ids.has(id)) results[id] = { status: r.status, note: r.note, updatedAt: now };
        }
        return { ...base, analysisGeneratedAt: analysis.generatedAt, environment: input.environment ?? base.environment, results, updatedAt: now };
      });
    return Response.json({ run: saved, summary: summarizeRun(analysis, saved ?? undefined), analysisChanged: false });
  });
}
