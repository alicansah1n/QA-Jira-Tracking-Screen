import { listProjectReleases } from "@/domain/releases/service";
import { getAnalysisStore, getContext } from "@/lib/server/context";
import { AppError, handle, projectKeyParam } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Takip edilen projenin canlıya çıkmamış release'leri ve uyarılar. */
export async function GET(request: Request) {
  return handle(async () => {
    const c = getContext();
    const key = projectKeyParam(new URL(request.url).searchParams.get("project"));
    if (!(await c.settings.read()).projects[key]) throw new AppError(404, "NOT_TRACKED", "Bu proje takip edilmiyor; Ayarlar'dan ekleyin.");
    return Response.json(await listProjectReleases(c, key, getAnalysisStore()));
  });
}
