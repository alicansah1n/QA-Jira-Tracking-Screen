import { z } from "zod";
import { ISSUE_KEY_PATTERN } from "@/domain/analysis/schema";
import { sendDevRequest, type SendResult } from "@/domain/inbox/service";
import { readJsonBody } from "@/lib/server/body";
import { getContext } from "@/lib/server/context";
import { handle } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Input = z.object({
  items: z
    .array(z.object({ key: z.string().regex(ISSUE_KEY_PATTERN), developers: z.array(z.string().min(1)).min(1).max(20) }))
    .min(1)
    .max(50),
  confirm: z.literal(true),
});

/** Onaylanan bilgi taleplerini sırayla gönderir (paralel değil: her biri doğrulamalı). */
export async function POST(request: Request) {
  return handle(async () => {
    const { items } = Input.parse(await readJsonBody(request, 32 * 1024));
    const ctx = getContext();
    await ctx.myself();
    const results: SendResult[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      results.push(await sendDevRequest(ctx, item.key, item.developers));
    }
    return Response.json({ results });
  });
}
