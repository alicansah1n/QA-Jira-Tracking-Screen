import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acknowledgeJournal, executeReleaseClose, ReleaseCloseError, rollbackInterrupted, rollbackJournal } from "@/domain/release-close/executor";
import { buildReleasePlan } from "@/domain/release-close/preflight";
import type { Context } from "@/lib/server/context";
import { setupFakeContext, STATUS, type FakeJira } from "../helpers/fake-jira";

let ctx: Context;
let fake: FakeJira;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ ctx, fake, cleanup } = await setupFakeContext());
});
afterEach(async () => {
  await cleanup();
});

const TBD = STATUS.toBeDeployed.id;
const DONE = STATUS.completed.id;

function seed(statuses: Record<string, string>) {
  let n = 1;
  for (const [key, statusId] of Object.entries(statuses)) fake.addIssue({ id: String(n++), key, summary: `${key} özet`, statusId });
  fake.addVersion("500", "v1.0", Object.keys(statuses));
}

async function close() {
  const plan = await buildReleasePlan(ctx, "500");
  return { plan, journal: await executeReleaseClose(ctx, "500", plan.fingerprint, null) };
}

describe("Release kapatma — kurallar", () => {
  it("To be Deployed + Completed: TBD'ler Completed olur, yorum eklenir, release kapanır", async () => {
    seed({ "DEMO-1": TBD, "DEMO-2": TBD, "DEMO-3": DONE });
    const { plan, journal } = await close();
    expect(plan.scenario).toBe("mixed");
    expect(journal.state).toBe("committed");
    expect(fake.statusOf("DEMO-1")).toBe(DONE);
    expect(fake.statusOf("DEMO-2")).toBe(DONE);
    expect(fake.commentCount("DEMO-1")).toBe(1);
    expect(fake.commentCount("DEMO-3")).toBe(0);
    expect(fake.versions.get("500")?.released).toBe(true);
  });

  it("Hepsi To be Deployed: aynı işlem", async () => {
    seed({ "DEMO-1": TBD, "DEMO-2": TBD });
    const { plan, journal } = await close();
    expect(plan.scenario).toBe("all-to-be-deployed");
    expect(journal.state).toBe("committed");
    expect([fake.statusOf("DEMO-1"), fake.statusOf("DEMO-2")]).toEqual([DONE, DONE]);
  });

  it("Hepsi Completed: maddelere dokunulmaz, release kapanır", async () => {
    seed({ "DEMO-1": DONE, "DEMO-2": DONE });
    const { plan, journal } = await close();
    expect(plan.scenario).toBe("all-completed");
    expect(journal.state).toBe("committed");
    expect(fake.calls.filter((c) => c.startsWith("transition") || c.startsWith("comment"))).toEqual([]);
    expect(fake.versions.get("500")?.released).toBe(true);
  });

  it("1 madde bile farklı statüde: önizleme görülür, işlem başlatılamaz, hiçbir şey değişmez", async () => {
    seed({ "DEMO-1": TBD, "DEMO-2": STATUS.inTest.id });
    const plan = await buildReleasePlan(ctx, "500");
    expect(plan.canExecute).toBe(false);
    expect(plan.issues.find((i) => i.key === "DEMO-2")?.action).toBe("blocked");
    await expect(executeReleaseClose(ctx, "500", plan.fingerprint, null)).rejects.toMatchObject({ code: "BLOCKED" });
    expect(fake.calls).toEqual([]);
  });

  it("Pakette hiç madde yok: başlatılamaz", async () => {
    fake.addVersion("500", "v1.0", []);
    const plan = await buildReleasePlan(ctx, "500");
    expect(plan.canExecute).toBe(false);
    expect(plan.blockers.join()).toContain("hiç madde yok");
  });

  it("Geçirilemeyen madde: Completed'a geçişi yoksa başlamaz", async () => {
    seed({ "DEMO-1": TBD });
    fake.transitions.set(TBD, []);
    const plan = await buildReleasePlan(ctx, "500");
    expect(plan.canExecute).toBe(false);
    expect(plan.issues[0]?.problem).toContain("geçiş yok");
  });

  it("Önizlemeden sonra statü değişirse başlamaz", async () => {
    seed({ "DEMO-1": TBD, "DEMO-2": TBD });
    const plan = await buildReleasePlan(ctx, "500");
    fake.issues.get("DEMO-2")!.statusId = DONE;
    await expect(executeReleaseClose(ctx, "500", plan.fingerprint, null)).rejects.toMatchObject({ code: "DRIFT" });
    expect(fake.calls).toEqual([]);
  });

  it("Önizlemeden sonra release'e madde eklenirse başlamaz", async () => {
    seed({ "DEMO-1": TBD });
    const plan = await buildReleasePlan(ctx, "500");
    fake.addIssue({ id: "9", key: "DEMO-9", summary: "yeni", statusId: TBD, versionIds: ["500"] });
    await expect(executeReleaseClose(ctx, "500", plan.fingerprint, null)).rejects.toBeInstanceOf(ReleaseCloseError);
    expect(fake.calls).toEqual([]);
  });

  it("Versiyon yönetimi yetkisi yoksa başlamaz", async () => {
    seed({ "DEMO-1": DONE });
    fake.permissions.ADMINISTER_PROJECTS = false;
    const plan = await buildReleasePlan(ctx, "500");
    expect(plan.canExecute).toBe(false);
  });
});

describe("Release kapatma — ya hepsi ya hiçbiri", () => {
  it("ikinci maddenin geçişi başarısız olursa ilk maddenin geçişi ve yorumu geri alınır, release açık kalır", async () => {
    seed({ "DEMO-1": TBD, "DEMO-2": TBD });
    fake.faults.transition = (key) => (key === "DEMO-2" ? "error400" : undefined);
    const { journal } = await close();
    expect(journal.state).toBe("rolled_back");
    expect(fake.statusOf("DEMO-1")).toBe(TBD);
    expect(fake.statusOf("DEMO-2")).toBe(TBD);
    expect(fake.commentCount("DEMO-1")).toBe(0);
    expect(fake.versions.get("500")?.released).toBe(false);
  });

  it("release adımı başarısız olursa tüm geçişler ve yorumlar geri alınır", async () => {
    seed({ "DEMO-1": TBD, "DEMO-2": TBD, "DEMO-3": DONE });
    fake.faults.release = () => "error400";
    const { journal } = await close();
    expect(journal.state).toBe("rolled_back");
    expect([fake.statusOf("DEMO-1"), fake.statusOf("DEMO-2"), fake.statusOf("DEMO-3")]).toEqual([TBD, TBD, DONE]);
    expect(fake.commentCount("DEMO-1") + fake.commentCount("DEMO-2")).toBe(0);
    expect(fake.versions.get("500")?.released).toBe(false);
  });

  it("yorum adımı başarısız olursa o maddenin geçişi geri alınır", async () => {
    seed({ "DEMO-1": TBD });
    fake.faults.comment = (key) => (key === "DEMO-1" ? "error400" : undefined);
    const { journal } = await close();
    expect(journal.state).toBe("rolled_back");
    expect(fake.statusOf("DEMO-1")).toBe(TBD);
  });

  it("sonucu bilinmeyen ama uygulanmış geçiş doğrulanıp tamamlanmış sayılır; mükerrer geçiş yapılmaz", async () => {
    seed({ "DEMO-1": TBD });
    fake.faults.transition = () => "applied500";
    const { journal } = await close();
    expect(journal.state).toBe("committed");
    expect(fake.calls.filter((c) => c.startsWith("transition:DEMO-1"))).toHaveLength(1);
  });

  it("sonucu bilinmeyen ve uygulanmış yorum işaretinden bulunur, geri almada silinir", async () => {
    seed({ "DEMO-1": TBD });
    fake.faults.comment = () => "applied500";
    fake.faults.release = () => "error400";
    const { journal } = await close();
    expect(journal.state).toBe("rolled_back");
    expect(fake.commentCount("DEMO-1")).toBe(0);
  });

  it("geri geçiş yoksa geri alma eksik kalır ve açıkça raporlanır", async () => {
    seed({ "DEMO-1": TBD, "DEMO-2": TBD });
    fake.transitions.set(DONE, []);
    fake.faults.transition = (key) => (key === "DEMO-2" ? "error400" : undefined);
    const { journal } = await close();
    expect(journal.state).toBe("rollback_failed");
    expect(journal.steps.find((s) => s.kind === "transition" && s.issueKey === "DEMO-1")?.state).toBe("rollback_failed");
  });

  it("yarıda kalmış (çökmüş) bir kayıt sonradan geri alınabilir", async () => {
    seed({ "DEMO-1": TBD });
    const runId = "rc-crash-0001";
    // İşlem geçişi yapıp yorumu yazarken çökmüş gibi: geçiş Jira'da uygulanmış, günlükte "pending".
    fake.issues.get("DEMO-1")!.statusId = DONE;
    await ctx.journal(runId).update(() => ({
      runId,
      versionId: "500",
      versionName: "v1.0",
      projectKey: "DEMO",
      releaseDate: "2026-10-07",
      toBeDeployed: { id: TBD, name: "To be Deployed" },
      completed: { id: DONE, name: "Completed" },
      issues: [{ key: "DEMO-1", summary: "x", action: "transition" }],
      state: "running",
      steps: [{ kind: "transition", issueKey: "DEMO-1", state: "pending", at: "2026-10-07T10:00:00Z" }],
      notifications: [],
      startedAt: "2026-10-07T10:00:00Z",
    }));
    // Yarıda kalmış kayıt varken yeni kapatma başlatılamaz.
    const plan = await buildReleasePlan(ctx, "500");
    await expect(executeReleaseClose(ctx, "500", plan.fingerprint, null)).rejects.toMatchObject({ code: "BUSY" });

    const journal = await rollbackJournal(ctx, runId);
    expect(journal.state).toBe("rolled_back");
    expect(fake.statusOf("DEMO-1")).toBe(TBD);
  });
});

describe("Release kapatma — inceleme sonrası düzeltmeler", () => {
  it("geri almada planlanan release tarihi geri yüklenir", async () => {
    seed({ "DEMO-1": DONE });
    // Release adımı uygulanmış (bugünün tarihiyle) ve süreç commit'ten önce çökmüş gibi.
    Object.assign(fake.versions.get("500")!, { released: true, releaseDate: "2026-10-07" });
    const runId = "rc-date-0001";
    await ctx.journal(runId).update(() => ({
      runId,
      versionId: "500",
      versionName: "v1.0",
      projectKey: "DEMO",
      releaseDate: "2026-10-07",
      originalVersion: { released: false, releaseDate: "2026-10-10" },
      toBeDeployed: { id: TBD, name: "To be Deployed" },
      completed: { id: DONE, name: "Completed" },
      issues: [{ key: "DEMO-1", summary: "x", action: "none" }],
      state: "running",
      steps: [{ kind: "release", state: "done", at: "2026-10-07T10:00:00Z" }],
      notifications: [],
      startedAt: "2026-10-07T10:00:00Z",
    }));
    const journal = await rollbackJournal(ctx, runId);
    expect(journal.state).toBe("rolled_back");
    expect(fake.versions.get("500")).toMatchObject({ released: false, releaseDate: "2026-10-10" });
  });

  it("Teams hedefi bulunamasa da tamamlanmış kapatma başarılı döner, bildirim hatası kaydedilir", async () => {
    seed({ "DEMO-1": DONE });
    const plan = await buildReleasePlan(ctx, "500");
    const journal = await executeReleaseClose(ctx, "500", plan.fingerprint, "t-yokboyle1");
    expect(journal.state).toBe("committed");
    expect(journal.notifications.at(-1)).toMatchObject({ ok: false });
  });

  it("geri alması eksik kalan kayıt yeni kapatmayı engeller; elle düzeltildi onayıyla açılır", async () => {
    seed({ "DEMO-1": TBD, "DEMO-2": TBD });
    fake.transitions.set(DONE, []);
    fake.faults.transition = (key) => (key === "DEMO-2" ? "error400" : undefined);
    const { journal } = await close();
    expect(journal.state).toBe("rollback_failed");

    fake.faults.transition = undefined;
    fake.issues.get("DEMO-1")!.statusId = TBD;
    const plan = await buildReleasePlan(ctx, "500");
    await expect(executeReleaseClose(ctx, "500", plan.fingerprint, null)).rejects.toMatchObject({ code: "BUSY" });

    await acknowledgeJournal(ctx, journal.runId);
    fake.transitions.set(DONE, [{ id: "51", name: "Reopen deploy", to: TBD }]);
    const again = await executeReleaseClose(ctx, "500", (await buildReleasePlan(ctx, "500")).fingerprint, null);
    expect(again.state).toBe("committed");
  });

  it("birkaç dakika içinde adım yazmış (canlı olabilecek) kayıt geri alınmaz", async () => {
    seed({ "DEMO-1": TBD });
    const runId = "rc-live-0001";
    const now = new Date().toISOString();
    await ctx.journal(runId).update(() => ({
      runId,
      versionId: "500",
      versionName: "v1.0",
      projectKey: "DEMO",
      releaseDate: "2026-10-07",
      toBeDeployed: { id: TBD, name: "To be Deployed" },
      completed: { id: DONE, name: "Completed" },
      issues: [{ key: "DEMO-1", summary: "x", action: "transition" }],
      state: "running",
      steps: [{ kind: "transition", issueKey: "DEMO-1", state: "pending", at: now }],
      notifications: [],
      startedAt: now,
    }));
    await expect(rollbackInterrupted(ctx, runId)).rejects.toBeInstanceOf(ReleaseCloseError);
    await expect(rollbackInterrupted(ctx, runId, Date.now() + 5 * 60_000)).resolves.toMatchObject({ state: "rolled_back" });
  });
});

