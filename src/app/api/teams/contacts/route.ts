import { randomBytes } from "node:crypto";
import { z } from "zod";
import { DisplayNameSchema, MAX_TEAMS_CONTACTS } from "@/domain/settings/schema";
import { readJsonBody } from "@/lib/server/body";
import { getContext } from "@/lib/server/context";
import { publicSettings } from "@/lib/server/public-settings";
import { AppError, handle } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Input = z.object({ name: DisplayNameSchema, email: z.email().max(254) });

/** "Kişiler" hedefine gönderirken seçilebilecek kişiyi ekler. */
export async function POST(request: Request) {
  return handle(async () => {
    const input = Input.parse(await readJsonBody(request, 4 * 1024));
    const email = input.email.toLowerCase();
    const id = `c-${randomBytes(5).toString("hex")}`;
    const saved = await getContext().settings.update((s) => {
      if (s.teams.contacts.length >= MAX_TEAMS_CONTACTS) throw new AppError(422, "LIMIT", `Kişi listesi dolu (en fazla ${MAX_TEAMS_CONTACTS}).`);
      if (s.teams.contacts.some((c) => c.email === email)) throw new AppError(409, "DUPLICATE", "Bu e-posta zaten kişi listesinde.");
      return { ...s, teams: { ...s.teams, contacts: [...s.teams.contacts, { id, name: input.name, email }] } };
    });
    return Response.json({ settings: publicSettings(saved), id }, { status: 201 });
  });
}
