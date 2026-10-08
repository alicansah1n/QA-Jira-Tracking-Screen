import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { plain, releaseClosedCard } from "@/lib/teams/cards";
import { sendTeamsCard, TeamsError, validateWebhookUrl } from "@/lib/teams/webhook";
import { server } from "../helpers/msw";

describe("validateWebhookUrl", () => {
  it("yalnızca https ve Microsoft webhook alan adlarını kabul eder", () => {
    expect(validateWebhookUrl("https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=x").ok).toBe(true);
    expect(validateWebhookUrl("https://teamsystem.webhook.office.com/webhookb2/abc").ok).toBe(true);
    expect(validateWebhookUrl("https://x.environment.api.powerplatform.com/powerautomate/abc").ok).toBe(true);
    expect(validateWebhookUrl("http://teamsystem.webhook.office.com/x").ok).toBe(false);
    expect(validateWebhookUrl("https://evil.example/webhook.office.com").ok).toBe(false);
    expect(validateWebhookUrl("https://webhook.office.com.evil.example/x").ok).toBe(false);
    expect(validateWebhookUrl("https://user:pass@a.webhook.office.com/x").ok).toBe(false);
    expect(validateWebhookUrl("çöp").ok).toBe(false);
  });
});

describe("sendTeamsCard", () => {
  const url = "https://a.webhook.office.com/webhookb2/abc";

  it("Adaptive Card'ı message zarfıyla gönderir", async () => {
    let body: unknown;
    server.use(
      http.post(url, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 202 });
      }),
    );
    await sendTeamsCard(url, { type: "AdaptiveCard", version: "1.4", body: [] });
    expect(body).toMatchObject({ type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive" }] });
  });

  it("hata durumunu anlaşılır mesajla bildirir", async () => {
    server.use(http.post(url, () => new HttpResponse(null, { status: 404 })));
    await expect(sendTeamsCard(url, { type: "AdaptiveCard", version: "1.4", body: [] })).rejects.toBeInstanceOf(TeamsError);
  });

  it("izin verilmeyen adrese hiç istek atmaz", async () => {
    await expect(sendTeamsCard("https://evil.example/x", { type: "AdaptiveCard", version: "1.4", body: [] })).rejects.toThrow("webhook adresi");
  });
});

describe("kart içeriği", () => {
  it("Jira metnindeki işaretleme karakterlerini temizler (sahte link enjekte edilemez)", () => {
    expect(plain("[tıkla](https://evil) **kalın**")).toBe("tıklahttps:⁠//evil kalın");
    expect(plain("bkz www.evil.example")).toBe("bkz www⁠.evil.example");
    const card = releaseClosedCard({
      projectName: "P",
      versionName: "v1",
      releaseDate: "2026-10-07",
      closedBy: "QA",
      transitioned: [{ key: "P-1", summary: "[x](https://evil)" }],
      untouched: 0,
      jiraBaseUrl: "https://acme.atlassian.net",
      versionUrl: "https://acme.atlassian.net/projects/P/versions/1",
    });
    const json = JSON.stringify(card);
    expect(json).not.toContain("](https://evil)");
    expect(json).toContain("https://acme.atlassian.net/browse/P-1");
  });
});
