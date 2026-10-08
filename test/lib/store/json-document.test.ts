import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createJsonDocument, StoreError } from "@/lib/store/json-document";

const Schema = z.object({ count: z.number().int().nonnegative(), label: z.string().default("") });
type Doc = z.infer<typeof Schema>;

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "qa-store-"));
  file = path.join(dir, "nested", "doc.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const doc = (over: Partial<Parameters<typeof createJsonDocument<Doc>>[0]> = {}) =>
  createJsonDocument<Doc>({ file, schema: Schema, defaults: () => ({ count: 0, label: "" }), version: 2, ...over });

describe("createJsonDocument", () => {
  it("dosya yoksa varsayılanı döndürür, dosya oluşturmaz", async () => {
    await expect(doc().read()).resolves.toEqual({ count: 0, label: "" });
    await expect(readFile(file)).rejects.toThrow();
  });

  it("güncellemeyi sürüm zarfıyla kalıcı yazar (klasörü oluşturur)", async () => {
    await doc().update((d) => ({ ...d, count: 5 }));
    const raw = JSON.parse(await readFile(file, "utf8"));
    expect(raw).toEqual({ schemaVersion: 2, data: { count: 5, label: "" } });
    await expect(doc().read()).resolves.toEqual({ count: 5, label: "" });
  });

  it("eşzamanlı güncellemeleri kaybetmeden sıraya alır", async () => {
    const d = doc();
    await Promise.all(Array.from({ length: 25 }, () => d.update((x) => ({ ...x, count: x.count + 1 }))));
    await expect(d.read()).resolves.toMatchObject({ count: 25 });
  });

  it("şemaya uymayan veriyi yazmaz", async () => {
    const d = doc();
    await d.update((x) => ({ ...x, count: 1 }));
    await expect(d.update(() => ({ count: -1, label: "" }))).rejects.toBeInstanceOf(StoreError);
    await expect(d.read()).resolves.toMatchObject({ count: 1 });
  });

  it("başarısız güncelleme sonraki güncellemeleri engellemez", async () => {
    const d = doc();
    await expect(d.update(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(d.update((x) => ({ ...x, count: 9 }))).resolves.toMatchObject({ count: 9 });
  });

  it("bozuk JSON'da anlaşılır hata verir", async () => {
    await doc().update((x) => x);
    await writeFile(file, "{bozuk");
    await expect(doc().read()).rejects.toThrow("geçerli JSON değil");
  });

  it("daha yeni sürümle yazılmış dosyayı okumayı reddeder", async () => {
    await doc().update((x) => x);
    await writeFile(file, JSON.stringify({ schemaVersion: 3, data: { count: 1 } }));
    await expect(doc().read()).rejects.toThrow("daha yeni");
  });

  it("eski sürümü migrate ile günceller, migrate yoksa reddeder", async () => {
    await doc().update((x) => x);
    await writeFile(file, JSON.stringify({ schemaVersion: 1, data: { n: 4 } }));
    await expect(doc().read()).rejects.toThrow("geçişi tanımlı değil");
    const migrated = doc({ migrate: (data) => ({ count: (data as { n: number }).n }) });
    await expect(migrated.read()).resolves.toEqual({ count: 4, label: "" });
  });
});

describe("createJsonDocument — elle düzenlenmiş dosyalar", () => {
  it("UTF-8 BOM'lu dosyayı okur", async () => {
    await doc().update((x) => x);
    await writeFile(file, `﻿${JSON.stringify({ schemaVersion: 2, data: { count: 3 } })}`);
    await expect(doc().read()).resolves.toMatchObject({ count: 3 });
  });

  it("null ya da dizi içeriğinde anlaşılır hata verir", async () => {
    await doc().update((x) => x);
    await writeFile(file, "null");
    await expect(doc().read()).rejects.toBeInstanceOf(StoreError);
    await writeFile(file, "[]");
    await expect(doc().read()).rejects.toBeInstanceOf(StoreError);
  });
});
