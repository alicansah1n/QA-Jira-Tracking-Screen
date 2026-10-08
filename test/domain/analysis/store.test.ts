import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAnalysisStore } from "@/domain/analysis/store";
import { sampleAnalysis } from "./schema.test";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "qa-analyses-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("createAnalysisStore", () => {
  it("klasör yoksa boş liste döner", async () => {
    await expect(createAnalysisStore(path.join(dir, "yok")).list()).resolves.toEqual([]);
  });

  it("geçerli, geçersiz ve bozuk dosyaları ayırt eder; anahtar desenine uymayanları yok sayar", async () => {
    await writeFile(path.join(dir, "PROJ-12.json"), JSON.stringify(sampleAnalysis()));
    await writeFile(path.join(dir, "PROJ-13.json"), JSON.stringify(sampleAnalysis())); // içerik PROJ-12
    await writeFile(path.join(dir, "PROJ-14.json"), "{bozuk");
    await writeFile(path.join(dir, "notlar.json"), "{}");
    const entries = await createAnalysisStore(dir).list();
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e.ok]));
    expect(byKey).toEqual({ "PROJ-12": true, "PROJ-13": false, "PROJ-14": false });
  });

  it("UTF-8 BOM'lu dosyayı okur (Windows editörleri)", async () => {
    await writeFile(path.join(dir, "PROJ-12.json"), `﻿${JSON.stringify(sampleAnalysis())}`);
    await expect(createAnalysisStore(dir).load("PROJ-12")).resolves.toMatchObject({ ok: true });
  });

  it("geçersiz anahtarla dosya yoluna erişmez", () => {
    const store = createAnalysisStore(dir);
    expect(() => store.fileOf("../../secret")).toThrow("Geçersiz madde anahtarı");
    expect(() => store.fileOf("PROJ-1/../../x")).toThrow("Geçersiz madde anahtarı");
  });

  it("kaydederken doğrular; varsa üzerine yazmak için onay ister", async () => {
    const store = createAnalysisStore(dir);
    await expect(store.save({ schemaVersion: 1 }, { overwrite: false })).resolves.toMatchObject({ ok: false });

    await expect(store.save(sampleAnalysis(), { overwrite: false })).resolves.toEqual({ ok: true, key: "PROJ-12" });
    await expect(store.save(sampleAnalysis(), { overwrite: false })).resolves.toMatchObject({ ok: false, exists: true });

    const updated = sampleAnalysis({ summary: { overview: "Güncel özet" } });
    await expect(store.save(updated, { overwrite: true })).resolves.toMatchObject({ ok: true });
    const saved = JSON.parse(await readFile(path.join(dir, "PROJ-12.json"), "utf8"));
    expect(saved.summary.overview).toBe("Güncel özet");
  });
});
