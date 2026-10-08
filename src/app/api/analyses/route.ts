import { z } from "zod";
import { readJsonBody } from "@/lib/server/body";
import { getAnalysisStore } from "@/lib/server/context";
import { handle } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ImportSchema = z.object({ analysis: z.unknown(), overwrite: z.boolean().default(false) });

const MAX_BODY_BYTES = 1_000_000;

/** Arayüzden yapıştırılan analiz JSON'unu doğrulayıp kaydeder. */
export async function POST(request: Request) {
  return handle(async () => {
    const input = ImportSchema.parse(await readJsonBody(request, MAX_BODY_BYTES));
    const result = await getAnalysisStore().save(input.analysis, { overwrite: input.overwrite });
    if (!result.ok) {
      return Response.json(
        { error: { code: result.exists ? "EXISTS" : "INVALID", message: result.errors[0], details: result.errors } },
        { status: result.exists ? 409 : 422 },
      );
    }
    return Response.json({ key: result.key }, { status: 201 });
  });
}
