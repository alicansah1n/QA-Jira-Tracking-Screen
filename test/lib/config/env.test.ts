import { describe, expect, it } from "vitest";
import { loadEnv } from "@/lib/config/env";

const valid = {
  JIRA_BASE_URL: "https://acme.atlassian.net/",
  JIRA_EMAIL: "qa@acme.com",
  JIRA_API_TOKEN: "tok",
};

describe("loadEnv", () => {
  it("değerleri normalleştirir ve varsayılanları uygular", () => {
    const result = loadEnv(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.JIRA_BASE_URL).toBe("https://acme.atlassian.net");
    expect(result.env.DATA_DIR).toBe("./data");
  });

  it("eksik ve hatalı değerleri anahtarlarıyla raporlar", () => {
    const result = loadEnv({ ...valid, JIRA_BASE_URL: "http://acme.atlassian.net", JIRA_API_TOKEN: undefined });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.key).sort()).toEqual(["JIRA_API_TOKEN", "JIRA_BASE_URL"]);
    expect(result.issues.find((i) => i.key === "JIRA_API_TOKEN")?.message).toBe("Tanımlı değil");
  });

  it("hata mesajlarında sır değerlerini göstermez", () => {
    const result = loadEnv({ ...valid, JIRA_EMAIL: "gizli-deger" });
    expect(JSON.stringify(result)).not.toContain("gizli-deger");
  });
});
