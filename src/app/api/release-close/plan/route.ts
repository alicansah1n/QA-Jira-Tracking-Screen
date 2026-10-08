import { z } from "zod";
import { buildReleasePlan } from "@/domain/release-close/preflight";
import { readJsonBody } from "@/lib/server/body";
import { getContext } from "@/lib/server/context";
import { handle } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Input = z.object({ versionId: z.string().regex(/^\d{1,18}$/) });

/** Salt okuma önizleme: ne yapılacağı, engeller ve parmak izi. */
export async function POST(request: Request) {
  return handle(async () => {
    const { versionId } = Input.parse(await readJsonBody(request, 4 * 1024));
    return Response.json(await buildReleasePlan(getContext(), versionId));
  });
}
