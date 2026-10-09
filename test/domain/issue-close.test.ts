import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAnalysis, type IssueAnalysis } from "@/domain/analysis/schema";
import { executeClose, type CloseInput } from "@/domain/issue-close/service";
import type { Context } from "@/lib/server/context";
import { setupFakeContext, STATUS, type FakeJira } from "../helpers/fake-jira";
import { sampleAnalysis } from "./analysis/schema.test";

let ctx: Context;
let fake: FakeJira;
let cleanup: () => Promise<void>;
let analysis: IssueAnalysis;

beforeEach(async () => {
  ({ ctx, fake, cleanup } = await setupFakeContext());
  fake.addIssue({ id: "1", key: "PROJ-12", summary: "Fatura filtresi", statusId: STATUS.inTest.id });
  const parsed = parseAnalysis(sampleAnalysis());
  if (!parsed.ok) throw new Error(parsed.errors.join());
  analysis = parsed.analysis;
});
afterEach(async () => {
  await cleanup();
});

const input = (over: Partial<CloseInput> = {}): CloseInput => ({
  testAssignee: null,
  storyPointTest: null,
  comment: "Test tamamlandı",
  attachReport: true,
  transitionId: "31",
  teamsTargetId: null,
  teamsContactIds: [],
  reclose: false,
  ...over,
});

const close = (over?: Partial<CloseInput>) => executeClose(ctx, "PROJ-12", input(over), analysis, undefined, "https://test.atlassian.net/browse/PROJ-12");

describe("Madde kapatma", () => {
  it("rapor ekler, yorum yazar, statüyü değiştirir ve kaydı kapatır", async () => {
    const r = await close();
    expect(r.completed).toBe(true);
    expect(fake.attachments.get("PROJ-12")).toHaveLength(1);
    expect(fake.commentCount("PROJ-12")).toBe(1);
    expect(fake.statusOf("PROJ-12")).toBe(STATUS.toBeDeployed.id);
    const run = await ctx.run("PROJ-12").read();
    expect(run?.closedAt).toBeDefined();
    expect(run?.closeProgress).toBeUndefined();
  });

  it("geçiş başarısız olduktan sonra tekrar denemede rapor ve yorum ikinci kez gönderilmez", async () => {
    fake.faults.transition = () => "error400";
    const first = await close();
    expect(first.completed).toBe(false);
    expect(fake.attachments.get("PROJ-12")).toHaveLength(1);
    expect(fake.commentCount("PROJ-12")).toBe(1);

    fake.faults.transition = undefined;
    const second = await close();
    expect(second.completed).toBe(true);
    expect(fake.attachments.get("PROJ-12")).toHaveLength(1);
    expect(fake.commentCount("PROJ-12")).toBe(1);
    expect(second.results.find((x) => x.kind === "comment")?.message).toContain("önceki denemede");
  });

  it("daha önce kapatılmış maddeyi açık onay olmadan tekrar kapatmaz", async () => {
    await close();
    fake.issues.get("PROJ-12")!.statusId = STATUS.inTest.id;
    const again = await close();
    expect(again.completed).toBe(false);
    expect(again.plan.blockers.join()).toContain("daha önce");
    expect(fake.commentCount("PROJ-12")).toBe(1);

    const forced = await close({ reclose: true });
    expect(forced.completed).toBe(true);
    expect(fake.commentCount("PROJ-12")).toBe(2);
  });

  it("sonucu belirsiz ama uygulanmış yorumu işaretinden bulur, tekrar yazmaz", async () => {
    fake.faults.comment = () => "applied500";
    const r = await close();
    expect(r.completed).toBe(true);
    expect(fake.commentCount("PROJ-12")).toBe(1);
  });
});
