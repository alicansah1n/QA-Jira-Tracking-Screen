import { listInbox } from "@/domain/inbox/service";
import { getAnalysisStore, getContext } from "@/lib/server/context";
import { handle } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bana atanan açık maddeler; analiz ve bilgi talebi durumlarıyla. */
export async function GET() {
  return handle(async () => Response.json(await listInbox(getContext(), getAnalysisStore())));
}
