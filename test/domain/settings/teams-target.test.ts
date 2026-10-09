import { describe, expect, it } from "vitest";
import { SettingsSchema, teamsTargetLabel, TeamsTargetSchema } from "@/domain/settings/schema";

const url = "https://a.webhook.office.com/webhookb2/abc";

describe("Teams hedef türü", () => {
  it("türü olmayan eski kayıtları kanal sayar", () => {
    const s = SettingsSchema.parse({ teams: { targets: [{ id: "t-abc123", name: "QA", url }] } });
    expect(s.teams.targets[0]!.kind).toBe("channel");
    expect(s.teams.contacts).toEqual([]);
  });

  it("sohbet türünü korur, bilinmeyen türü reddeder", () => {
    expect(TeamsTargetSchema.parse({ id: "t-abc123", name: "Release", kind: "chat", url }).kind).toBe("chat");
    expect(TeamsTargetSchema.safeParse({ id: "t-abc123", name: "Release", kind: "user", url }).success).toBe(false);
  });

  it("seçim listesinde adı türüyle gösterir", () => {
    expect(teamsTargetLabel({ name: "QA Ekibi", kind: "channel" })).toBe("QA Ekibi · Kanal");
    expect(teamsTargetLabel({ name: "Release", kind: "chat" })).toBe("Release · Sohbet");
  });
});

describe("istemciye giden Teams hedefi", () => {
  it("türü taşır, adresi maskeler", async () => {
    const { publicSettings } = await import("@/lib/server/public-settings");
    const s = SettingsSchema.parse({ teams: { targets: [{ id: "t-abc123", name: "Release", kind: "chat", url }] } });
    const [t] = publicSettings(s).teams.targets;
    expect(t).toMatchObject({ id: "t-abc123", name: "Release", kind: "chat" });
    expect(t!.url).not.toContain("webhookb2/abc");
  });
});
