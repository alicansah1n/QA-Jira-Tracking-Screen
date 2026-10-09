import { getWeeklyReport } from "@/domain/weekly/service";
import { weekIdOf } from "@/domain/weekly/week";
import { getContext } from "@/lib/server/context";
import { handle, weekParam } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bir haftanın raporu; `week` verilmezse içinde bulunulan hafta (salt okuma). */
export async function GET(request: Request) {
  return handle(async () => {
    const raw = new URL(request.url).searchParams.get("week");
    const week = raw ? weekParam(raw) : weekIdOf(new Date());
    return Response.json(await getWeeklyReport(getContext(), week));
  });
}
