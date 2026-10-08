import { loadEnv } from "@/lib/config/env";
import { getContext } from "@/lib/server/context";
import { handle } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Kenar çubuğundaki kullanıcı kartı ve bağlantı durumu. */
export async function GET() {
  if (!loadEnv().ok) return Response.json({ connected: false, reason: "env" });
  return handle(async () => {
    const me = await getContext().myself();
    return Response.json({ connected: true, displayName: me.displayName, accountId: me.accountId, avatarUrl: me.avatarUrls?.["48x48"] });
  });
}
