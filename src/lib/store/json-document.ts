import "server-only";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";
import type { z } from "zod";

/**
 * Tek bir JSON dosyasında tutulan, şemayla doğrulanan ve sürümlenen belge.
 * Dosya biçimi: `{ "schemaVersion": n, "data": ... }`.
 *
 * - Yazmalar atomiktir (geçici dosya + rename); yarım yazılmış dosya oluşmaz.
 * - Aynı süreç içindeki güncellemeler sıraya alınır; farklı süreçlere karşı dosya kilidi kullanılır.
 */
export type JsonDocument<T> = {
  read(): Promise<T>;
  update(fn: (current: T) => T | Promise<T>): Promise<T>;
  readonly file: string;
};

export type JsonDocumentOptions<T> = {
  file: string;
  schema: z.ZodType<T>;
  defaults: () => T;
  version: number;
  /** Eski sürümlü veriyi güncel biçime çevirir. Verilmezse eski sürüm hata sayılır. */
  migrate?: (data: unknown, fromVersion: number) => unknown;
};

export class StoreError extends Error {
  // Next aynı modülü farklı paketlerde (sayfa / route) ayrı kopyalar olarak yükleyebilir; o zaman
  // `instanceof` kopyalar arasında tutmaz. Kontrol sınıf adına göre yapılır.
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null && (value as { name?: unknown }).name === "StoreError";
  }

  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`${path.basename(file)}: ${message}`);
    this.name = "StoreError";
  }
}

const queues = new Map<string, Promise<unknown>>();

function serialize<R>(key: string, task: () => Promise<R>): Promise<R> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

export function createJsonDocument<T>(options: JsonDocumentOptions<T>): JsonDocument<T> {
  const file = path.resolve(options.file);

  async function readUnlocked(): Promise<T> {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return options.defaults();
      throw error;
    }

    let envelope: { schemaVersion?: unknown; data?: unknown };
    try {
      // Not Defteri / PowerShell 5.1 dosyanın başına UTF-8 BOM ekleyebilir.
      envelope = JSON.parse(raw.replace(/^﻿/, ""));
    } catch {
      throw new StoreError(file, "dosya geçerli JSON değil");
    }
    if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
      throw new StoreError(file, "dosya beklenen biçimde değil");
    }

    let data = envelope.data;
    const version = typeof envelope.schemaVersion === "number" ? envelope.schemaVersion : 0;
    if (version > options.version) {
      throw new StoreError(file, `dosya daha yeni bir sürümle yazılmış (v${version})`);
    }
    if (version < options.version) {
      if (!options.migrate) throw new StoreError(file, `v${version} → v${options.version} geçişi tanımlı değil`);
      data = options.migrate(data, version);
    }

    const parsed = options.schema.safeParse(data);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new StoreError(file, `şemaya uymuyor (${issue?.path.join(".") ?? ""}: ${issue?.message ?? ""})`);
    }
    return parsed.data;
  }

  async function write(data: T): Promise<void> {
    const content = `${JSON.stringify({ schemaVersion: options.version, data }, null, 2)}\n`;
    await retryOnWindowsLock(() => writeFileAtomic(file, content, { encoding: "utf8" }));
  }

  /**
   * Görevi dosya kilidi altında çalıştırır. Kilit kaybedilirse (uyku, takılan event loop, başka
   * süreç) proper-lockfile'ın varsayılanı süreci çökertmektir; bunun yerine durum kaydedilir ve
   * görev yazmadan önce `assertLocked()` ile kontrol eder. Kilidi bırakma hatası, başarıyla
   * tamamlanmış bir yazmayı hataya çevirmez.
   */
  async function withFileLock<R>(task: (assertLocked: () => void) => Promise<R>): Promise<R> {
    await mkdir(path.dirname(file), { recursive: true });
    let compromised: Error | undefined;
    let release: () => Promise<void>;
    try {
      release = await lockfile.lock(file, {
        realpath: false,
        stale: 10_000,
        retries: { retries: 20, minTimeout: 25, maxTimeout: 250 },
        onCompromised: (error) => {
          compromised = error;
        },
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ELOCKED") {
        throw new StoreError(file, "dosya başka bir işlem tarafından kilitli; lütfen tekrar deneyin");
      }
      throw error;
    }
    try {
      return await task(() => {
        if (compromised) throw new StoreError(file, "dosya kilidi kaybedildi; değişiklik yazılmadı");
      });
    } finally {
      await release().catch((error: unknown) => {
        console.warn(`[store] ${path.basename(file)} kilidi bırakılamadı`, error);
      });
    }
  }

  return {
    file,
    read: () => readUnlocked(),
    update: (fn) =>
      serialize(file, () =>
        withFileLock(async (assertLocked) => {
          const current = await readUnlocked();
          const next = await fn(current);
          const parsed = options.schema.safeParse(next);
          if (!parsed.success) {
            const issue = parsed.error.issues[0];
            throw new StoreError(file, `yazılmak istenen veri şemaya uymuyor (${issue?.path.join(".") ?? ""}: ${issue?.message ?? ""})`);
          }
          assertLocked();
          await write(parsed.data);
          return parsed.data;
        }),
      ),
  };
}

/** Windows'ta antivirüs/indeksleyici dosyayı kısa süre tutabilir; rename EPERM/EBUSY verebilir. */
async function retryOnWindowsLock(task: () => Promise<void>, attempts = 5): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return await task();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") || i + 1 >= attempts) throw error;
      await new Promise((r) => setTimeout(r, 50 * 2 ** i));
    }
  }
}
