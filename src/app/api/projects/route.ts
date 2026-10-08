import { searchProjects } from "@/lib/jira/operations";
import { getContext } from "@/lib/server/context";
import { handle } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Kullanıcının erişebildiği Jira projeleri (takibe almak için). */
export async function GET() {
  return handle(async () => {
    const ctx = getContext();
    await ctx.myself();
    return Response.json({ projects: await searchProjects(ctx.jira) });
  });
}
