import { describe, expect, it } from "vitest";
import { discoverField, suggestInTestStatuses, suggestStatus } from "@/domain/settings/discovery";
import { FIELD_SPECS } from "@/domain/settings/schema";
import type { JiraField } from "@/lib/jira/schemas";

const spec = (key: string) => FIELD_SPECS.find((s) => s.key === key)!;

const field = (id: string, name: string, type: string, items?: string, custom = true): JiraField => ({
  id,
  name,
  custom,
  schema: { type, items },
});

describe("discoverField", () => {
  it("tek kesin eşleşmeyi önerir (büyük/küçük harf duyarsız)", () => {
    const fields = [field("customfield_1", "developer", "user"), field("summary", "Summary", "string", undefined, false)];
    const result = discoverField(fields, spec("developer"));
    expect(result.suggestion).toEqual({ id: "customfield_1", name: "developer" });
  });

  it("aynı isimde iki alan varsa öneri yapmaz, ikisini de aday gösterir", () => {
    const fields = [field("customfield_1", "Test Assignee", "user"), field("customfield_2", "Test Assignee", "user")];
    const result = discoverField(fields, spec("testAssignee"));
    expect(result.suggestion).toBeUndefined();
    expect(result.candidates.map((c) => c.id)).toEqual(["customfield_1", "customfield_2"]);
  });

  it("tipi uymayan alanı önermez ama aday olarak işaretler", () => {
    const fields = [field("customfield_9", "StoryPointTest", "string")];
    const result = discoverField(fields, spec("storyPointTest"));
    expect(result.suggestion).toBeUndefined();
    expect(result.candidates[0]).toMatchObject({ id: "customfield_9", typeMatches: false });
  });

  it("kullanıcı listesi (array<user>) Developer için uygundur, array<string> değildir", () => {
    const ok = discoverField([field("c1", "Developer", "array", "user")], spec("developer"));
    expect(ok.suggestion?.id).toBe("c1");
    const bad = discoverField([field("c2", "Developer", "array", "string")], spec("developer"));
    expect(bad.suggestion).toBeUndefined();
  });

  it("tam eşleşen ve tipi uyan aday önce gelir", () => {
    const fields = [
      field("c1", "Developer Notes", "string"),
      field("c2", "Developer", "user"),
    ];
    expect(discoverField(fields, spec("developer")).candidates[0]?.id).toBe("c2");
  });

  it("sistem alanlarını aday saymaz", () => {
    const result = discoverField([field("assignee", "Developer", "user", undefined, false)], spec("developer"));
    expect(result.candidates).toEqual([]);
  });
});

describe("suggestStatus", () => {
  const statuses = [
    { id: "1", name: "To be Deployed" },
    { id: "2", name: "Completed" },
    { id: "3", name: "In Test", statusCategory: { key: "indeterminate" } },
    { id: "4", name: "Test Done", statusCategory: { key: "done" } },
  ];

  it("isimle tek eşleşmeyi önerir", () => {
    expect(suggestStatus(statuses, ["to be deployed"])).toEqual({ id: "1", name: "To be Deployed" });
    expect(suggestStatus(statuses, ["Yok"])).toBeUndefined();
  });

  it("aynı isimde birden fazla statü varsa öneri yapmaz", () => {
    expect(suggestStatus([...statuses, { id: "9", name: "Completed" }], ["Completed"])).toBeUndefined();
  });

  it("testte statüsü önerisinde tamamlanmış kategoriyi dışlar", () => {
    expect(suggestInTestStatuses(statuses)).toEqual([{ id: "3", name: "In Test" }]);
  });
});
