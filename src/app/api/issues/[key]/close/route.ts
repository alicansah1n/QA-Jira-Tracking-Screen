import { z } from "zod";
import { CloseInputSchema, defaultCloseComment, executeClose } from "@/domain/issue-close/service";
import { reportFilename } from "@/domain/report/html";
import { summarizeRun, VERDICT_LABELS } from "@/domain/testrun/schema";
import { getTransitions } from "@/lib/jira/operations";
import { readJsonBody } from "@/lib/server/body";
import { getAnalysisStore, getContext, jiraBrowseUrl } from "@/lib/server/context";
import { AppError, handle, issueKeyParam } from "@/lib/server/respond";
import { testClosedCard } from "@/lib/teams/cards";
import { sendTeamsCard } from "@/lib/teams/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function load(key: string) {
  const entry = await getAnalysisStore().load(key);
  if (!entry?.ok) throw new AppError(404, "NOT_FOUND", "Bu madde için geçerli analiz yok");
  const c = getContext();
  return { c, analysis: entry.analysis, run: (await c.run(key).read()) ?? undefined };
}

/** Sihirbazın başlangıç değerleri: geçişler, varsayılan yorum, testçi. */
export async function GET(_: Request, ctx: RouteContext<"/api/issues/[key]/close">) {
  return handle(async () => {
    const key = issueKeyParam((await ctx.params).key);
    const { c, analysis, run } = await load(key);
    const [me, transitions, settings] = await Promise.all([c.myself(), getTransitions(c.jira, key), c.settings.read()]);
    return Response.json({
      me: { accountId: me.accountId, displayName: me.displayName },
      transitions: transitions.map((t) => ({ id: t.id, name: t.name, to: t.to.name, toCategory: t.to.statusCategory?.key })),
      defaultComment: defaultCloseComment(analysis, run, reportFilename(key, new Date().toISOString())),
      summary: summarizeRun(analysis, run),
      closedAt: run?.closedAt ?? null,
      fieldsMapped: { testAssignee: Boolean(settings.fields.testAssignee), storyPointTest: Boolean(settings.fields.storyPointTest) },
      teamsTargets: settings.teams.targets.map((t) => ({ id: t.id, name: t.name })),
    });
  });
}

const ExecuteSchema = CloseInputSchema.extend({ confirm: z.literal(true) });

/** Onaylanan kapanışı uygular. */
export async function POST(request: Request, ctx: RouteContext<"/api/issues/[key]/close">) {
  return handle(async () => {
    const key = issueKeyParam((await ctx.params).key);
    const input = ExecuteSchema.parse(await readJsonBody(request, 64 * 1024));
    const { c, analysis, run } = await load(key);
    const issueUrl = jiraBrowseUrl(key) ?? "";
    const outcome = await executeClose(c, key, input, analysis, run, issueUrl);

    let teams: { ok: boolean; message?: string } | undefined;
    if (outcome.completed && input.teamsTargetId) {
      const target = (await c.settings.read()).teams.targets.find((t) => t.id === input.teamsTargetId);
      if (target) {
        const s = summarizeRun(analysis, run);
        try {
          await sendTeamsCard(
            target.url,
            testClosedCard({
              issueKey: key,
              summary: analysis.issue.summary,
              verdict: VERDICT_LABELS[s.verdict],
              counts: { ...s.counts, total: s.total },
              tester: input.testAssignee?.displayName ?? (await c.myself()).displayName,
              issueUrl,
            }),
          );
          teams = { ok: true };
        } catch (error) {
          teams = { ok: false, message: error instanceof Error ? error.message : "Teams'e gönderilemedi" };
        }
      }
    }
    return Response.json({ ...outcome, teams });
  });
}
