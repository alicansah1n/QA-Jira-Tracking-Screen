import { isReleaseCloseRunning, listJournals } from "@/domain/release-close/executor";
import { getContext } from "@/lib/server/context";
import { handle } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => Response.json({ journals: await listJournals(getContext()), running: isReleaseCloseRunning() }));
}
