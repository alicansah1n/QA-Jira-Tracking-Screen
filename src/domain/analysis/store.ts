import "server-only";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import { ISSUE_KEY_PATTERN, parseAnalysis, type IssueAnalysis } from "./schema";

export type AnalysisEntry =
  | { key: string; ok: true; analysis: IssueAnalysis; modifiedAt: string }
  | { key: string; ok: false; errors: string[]; modifiedAt: string };

/** `data/analyses/{KEY}.json` dosyaları. Claude Code yazar; uygulama okur ve doğrular. */
export function createAnalysisStore(dir: string) {
  const fileOf = (key: string) => {
    // Anahtar desenine uymayan değerler dosya yoluna hiç ulaşmaz (path traversal).
    if (!ISSUE_KEY_PATTERN.test(key)) throw new Error(`Geçersiz madde anahtarı: ${key}`);
    return path.join(dir, `${key}.json`);
  };

  async function load(key: string): Promise<AnalysisEntry | undefined> {
    const file = fileOf(key);
    let raw: string;
    let modifiedAt: string;
    try {
      [raw, modifiedAt] = await Promise.all([readFile(file, "utf8"), stat(file).then((s) => s.mtime.toISOString())]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    let data: unknown;
    try {
      data = JSON.parse(raw.replace(/^﻿/, ""));
    } catch {
      return { key, ok: false, errors: ["Dosya geçerli JSON değil"], modifiedAt };
    }
    const result = parseAnalysis(data, key);
    return result.ok ? { key, ok: true, analysis: result.analysis, modifiedAt } : { key, ok: false, errors: result.errors, modifiedAt };
  }

  return {
    dir,
    fileOf,
    load,

    async list(): Promise<AnalysisEntry[]> {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
      const keys = names
        .filter((n) => n.endsWith(".json"))
        .map((n) => n.slice(0, -5))
        .filter((k) => ISSUE_KEY_PATTERN.test(k));
      const entries = await Promise.all(keys.map(load));
      return entries
        .filter((e): e is AnalysisEntry => e !== undefined)
        .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    },

    /** Arayüzden yapıştırılan JSON'u doğrulayıp kaydeder. */
    async save(data: unknown, { overwrite }: { overwrite: boolean }): Promise<{ ok: true; key: string } | { ok: false; errors: string[]; exists?: boolean }> {
      const result = parseAnalysis(data);
      if (!result.ok) return result;
      const key = result.analysis.issue.key;
      if (!overwrite && (await load(key).catch(() => undefined))) {
        return { ok: false, exists: true, errors: [`${key} için zaten bir analiz var`] };
      }
      await mkdir(dir, { recursive: true });
      await writeFileAtomic(fileOf(key), `${JSON.stringify(result.analysis, null, 2)}\n`, { encoding: "utf8" });
      return { ok: true, key };
    },
  };
}

export type AnalysisStore = ReturnType<typeof createAnalysisStore>;
