import { getWeeklyHistory } from "@/domain/weekly/service";
import { getContext } from "@/lib/server/context";
import { handle } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Son haftaların rapor sayıları (salt okuma). */
export async function GET() {
  return handle(async () => Response.json(await getWeeklyHistory(getContext())));
}
