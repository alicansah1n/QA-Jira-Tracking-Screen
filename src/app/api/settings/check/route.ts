import { runConnectionCheck } from "@/domain/settings/connection-check";
import { getContext } from "@/lib/server/context";
import { handle } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Salt okuma: Jira kimlik doğrulaması ve alan önerileri. */
export async function GET() {
  return handle(async () => Response.json(await runConnectionCheck(getContext().jira)));
}
