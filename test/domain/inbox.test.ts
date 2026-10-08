import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEV_REQUEST_PROPERTY } from "@/domain/inbox/dev-request";
import { listInbox, sendDevRequest } from "@/domain/inbox/service";
import { getAnalysisStore } from "@/lib/server/context";
import type { Context } from "@/lib/server/context";
import { setupFakeContext, STATUS, type FakeJira } from "../helpers/fake-jira";

let ctx: Context;
let fake: FakeJira;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ ctx, fake, cleanup } = await setupFakeContext());
  fake.addIssue({ id: "1", key: "DEMO-1", summary: "Yeni ekran", statusId: STATUS.inTest.id, developer: { accountId: "dev-1", displayName: "Ayşe Dev" } });
});
afterEach(async () => {
  await cleanup();
});

describe("Bilgi talebi", () => {
  it("developer'ı etiketleyen yorum gönderir, işaret ve defter yazar; ikinci kez göndermez", async () => {
    await expect(sendDevRequest(ctx, "DEMO-1")).resolves.toMatchObject({ outcome: "sent" });
    expect(fake.commentCount("DEMO-1")).toBe(1);
    const body = JSON.stringify(fake.comments.get("DEMO-1")![0]!.body);
    expect(body).toContain('"type":"mention"');
    expect(body).toContain("dev-1");
    expect(fake.properties.get(`DEMO-1/${DEV_REQUEST_PROPERTY}`)).toBeDefined();

    await expect(sendDevRequest(ctx, "DEMO-1")).resolves.toMatchObject({ outcome: "already-sent" });
    expect(fake.commentCount("DEMO-1")).toBe(1);
  });

  it("Jira'da işaret varsa (başka cihazdan gönderilmiş) yorum atmaz", async () => {
    fake.properties.set(`DEMO-1/${DEV_REQUEST_PROPERTY}`, { commentId: "77" });
    await expect(sendDevRequest(ctx, "DEMO-1")).resolves.toMatchObject({ outcome: "already-sent" });
    expect(fake.commentCount("DEMO-1")).toBe(0);
  });

  it("gönderim anında component eklenmişse kurala uymadığı için atlar", async () => {
    fake.issues.get("DEMO-1")!.components = ["Ödeme"];
    await expect(sendDevRequest(ctx, "DEMO-1")).resolves.toMatchObject({ outcome: "skipped" });
    expect(fake.commentCount("DEMO-1")).toBe(0);
  });

  it("aynı anda gelen iki gönderimden yalnızca biri yorum atar", async () => {
    const results = await Promise.all([sendDevRequest(ctx, "DEMO-1"), sendDevRequest(ctx, "DEMO-1")]);
    expect(results.map((r) => r.outcome).sort()).toEqual(["sent", "unknown"]);
    expect(fake.commentCount("DEMO-1")).toBe(1);
  });

  it("önizlemedeki developer değişmişse göndermez ve maddeyi kuyrukta bırakır", async () => {
    await expect(sendDevRequest(ctx, "DEMO-1", ["baska-dev"])).resolves.toMatchObject({ outcome: "skipped" });
    expect(fake.commentCount("DEMO-1")).toBe(0);
    expect((await ctx.ledger.read()).entries["DEMO-1"]).toBeUndefined();
    await expect(sendDevRequest(ctx, "DEMO-1", ["dev-1"])).resolves.toMatchObject({ outcome: "sent" });
  });

  it("developer alanı boşsa göndermez", async () => {
    fake.issues.get("DEMO-1")!.developer = undefined;
    await expect(sendDevRequest(ctx, "DEMO-1")).resolves.toMatchObject({ outcome: "skipped" });
  });

  it("sonucu bilinmeyen ama uygulanmış yorumu işaretinden bulur; mükerrer yorum atmaz", async () => {
    fake.faults.comment = () => "applied500";
    await expect(sendDevRequest(ctx, "DEMO-1")).resolves.toMatchObject({ outcome: "sent" });
    expect(fake.commentCount("DEMO-1")).toBe(1);
  });

  it("sonucu bilinmeyen ve uygulanmamış yorumu 'unknown' bırakır; tekrar denemede gönderir", async () => {
    fake.faults.comment = () => "error500";
    await expect(sendDevRequest(ctx, "DEMO-1")).resolves.toMatchObject({ outcome: "unknown" });
    expect((await ctx.ledger.read()).entries["DEMO-1"]?.state).toBe("unknown");
    fake.faults.comment = undefined;
    await expect(sendDevRequest(ctx, "DEMO-1")).resolves.toMatchObject({ outcome: "sent" });
    expect(fake.commentCount("DEMO-1")).toBe(1);
  });
});

describe("Gelen kutusu", () => {
  it("maddeleri yeni/analiz/bilgi talebi durumlarıyla listeler", async () => {
    const result = await listInbox(ctx, getAnalysisStore());
    const item = result.items.find((i) => i.key === "DEMO-1")!;
    expect(item.isNew).toBe(true);
    expect(item.analysis.state).toBe("none");
    expect(item.devRequest.eligibility.eligible).toBe(true);
    expect(item.devRequest.preview).toContain("@Ayşe Dev");
  });
});
