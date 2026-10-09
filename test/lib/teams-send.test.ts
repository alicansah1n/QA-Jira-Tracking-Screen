import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { DisplayNameSchema, MAX_TEAMS_RECIPIENTS, SettingsSchema } from "@/domain/settings/schema";
import { publicSettings } from "@/lib/server/public-settings";
import { deliverTeamsCard, resolveTeamsTarget, TeamsTargetError } from "@/lib/teams/send";
import { server } from "../helpers/msw";

const url = "https://a.webhook.office.com/webhookb2/people";
const flowKey = "0123456789abcdef0123456789abcdef";
const contacts = Array.from({ length: MAX_TEAMS_RECIPIENTS + 1 }, (_, i) => ({ id: `c-kisi${String(i).padStart(3, "0")}`, name: `Kişi ${i}`, email: `kisi${i}@firma.com` }));
const settings = SettingsSchema.parse({
  teams: {
    targets: [
      { id: "t-people1", name: "Kişilere", kind: "people", url, flowKey },
      { id: "t-chan01", name: "QA", kind: "channel", url },
    ],
    contacts,
  },
});
const card = { type: "AdaptiveCard" as const, version: "1.4", body: [] };

describe("resolveTeamsTarget", () => {
  it("gönderim ve deneme için kişi sınırını uygular", () => {
    const ids = contacts.map((c) => c.id);
    expect(() => resolveTeamsTarget(settings, { targetId: "t-people1", contactIds: ids })).toThrow(TeamsTargetError);
    expect(resolveTeamsTarget(settings, { targetId: "t-people1", contactIds: ids.slice(0, MAX_TEAMS_RECIPIENTS) }).recipients).toHaveLength(MAX_TEAMS_RECIPIENTS);
    expect(() => resolveTeamsTarget(settings, { targetId: "t-people1", contactIds: ids.slice(0, 4) }, { test: true })).toThrow("en fazla 3");
  });

  it("kanal hedefinde kişi seçimini yok sayar", () => {
    expect(resolveTeamsTarget(settings, { targetId: "t-chan01", contactIds: ["c-kisi000"] }).recipients).toEqual([]);
  });
});

describe("deliverTeamsCard", () => {
  function capture() {
    const seen: { key: string | null; body: Record<string, unknown> }[] = [];
    server.use(
      http.post(url, async ({ request }) => {
        seen.push({ key: request.headers.get("x-qa-key"), body: (await request.json()) as Record<string, unknown> });
        return new HttpResponse(null, { status: 202 });
      }),
    );
    return seen;
  }

  it("Kişiler hedefine akış anahtarını ve alıcıları gönderir", async () => {
    const seen = capture();
    await deliverTeamsCard(resolveTeamsTarget(settings, { targetId: "t-people1", contactIds: ["c-kisi001", "c-kisi002"] }), card);
    expect(seen[0]).toMatchObject({ key: flowKey, body: { recipients: ["kisi1@firma.com", "kisi2@firma.com"] } });
  });

  it("kanal hedefine anahtar ve alıcı göndermez", async () => {
    const seen = capture();
    await deliverTeamsCard(resolveTeamsTarget(settings, { targetId: "t-chan01", contactIds: [] }), card);
    expect(seen[0]?.key).toBeNull();
    expect(seen[0]?.body).not.toHaveProperty("recipients");
  });
});

describe("Teams ayarları", () => {
  it("adlarda yön değiştiren ve görünmez karakterleri reddeder", () => {
    expect(DisplayNameSchema.safeParse("Ayşe Yılmaz").success).toBe(true);
    expect(DisplayNameSchema.safeParse("Ali‮ezniM").success).toBe(false);
    expect(DisplayNameSchema.safeParse("Ali​").success).toBe(false);
  });

  it("akış anahtarını istemciye verir, adresi maskeler", () => {
    const [people, channel] = publicSettings(settings).teams.targets;
    expect(people).toMatchObject({ kind: "people", flowKey });
    expect(people!.url).not.toBe(url);
    expect(channel).not.toHaveProperty("flowKey");
  });
});
