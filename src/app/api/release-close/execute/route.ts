import { z } from "zod";
import { TEAMS_ID_PATTERN, TeamsContactIdsSchema } from "@/domain/settings/schema";
import { executeReleaseClose } from "@/domain/release-close/executor";
import { readJsonBody } from "@/lib/server/body";
import { getContext } from "@/lib/server/context";
import { handle } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Input = z.object({
  versionId: z.string().regex(/^\d{1,18}$/),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  teamsTargetId: z.string().regex(TEAMS_ID_PATTERN).nullable().default(null),
  teamsContactIds: TeamsContactIdsSchema,
  confirm: z.literal(true),
});

/** Onaylanan release kapatmayı uygular (ya hepsi ya hiçbiri). */
export async function POST(request: Request) {
  return handle(async () => {
    const input = Input.parse(await readJsonBody(request, 4 * 1024));
    const journal = await executeReleaseClose(
      getContext(),
      input.versionId,
      input.fingerprint,
      input.teamsTargetId ? { targetId: input.teamsTargetId, contactIds: input.teamsContactIds } : null,
    );
    return Response.json({ journal });
  });
}
