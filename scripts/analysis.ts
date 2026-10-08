/**
 * Kullanım:
 *   npm run analysis -- path PROJ-123       Analiz dosyasının yazılacağı yolu yazdırır
 *   npm run analysis -- validate PROJ-123   Analiz dosyasını şemaya göre doğrular
 *   npm run analysis -- schema              docs/schemas/issue-analysis.schema.json dosyasını üretir
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nextEnv from "@next/env";
import { z } from "zod";
import { IssueAnalysisSchema, ISSUE_KEY_PATTERN } from "@/domain/analysis/schema";
import { getAnalysisStore } from "@/lib/server/context";

nextEnv.loadEnvConfig(process.cwd());

// Doğrulama Jira bilgisi gerektirmez; yalnızca veri klasörü kullanılır.
const store = getAnalysisStore();

function requireKey(raw: string | undefined): string {
  const key = raw?.trim().toUpperCase();
  if (!key || !ISSUE_KEY_PATTERN.test(key)) {
    console.error("Geçerli bir madde anahtarı verin (ör. PROJ-123)");
    process.exit(2);
  }
  return key;
}

async function main() {
  const [command, arg] = process.argv.slice(2);

  if (command === "path") {
    console.log(store.fileOf(requireKey(arg)));
    return;
  }

  if (command === "validate") {
    const key = requireKey(arg);
    const entry = await store.load(key);
    if (!entry) {
      console.error(`Dosya yok: ${store.fileOf(key)}`);
      process.exit(1);
    }
    if (!entry.ok) {
      console.error(`GEÇERSİZ: ${store.fileOf(key)}`);
      for (const e of entry.errors) console.error(`  - ${e}`);
      process.exit(1);
    }
    const { testCases } = entry.analysis;
    const assumptions = testCases.filter((t) => t.assumption).length;
    console.log(`GEÇERLİ: ${key} — ${testCases.length} test case (${assumptions} varsayım)`);
    return;
  }

  if (command === "schema") {
    const out = path.resolve("docs/schemas/issue-analysis.schema.json");
    const schema = z.toJSONSchema(IssueAnalysisSchema, { io: "input", unrepresentable: "any" });
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
    console.log(`Yazıldı: ${path.relative(process.cwd(), out)}`);
    return;
  }

  console.error("Komutlar: path <KEY> | validate <KEY> | schema");
  process.exit(2);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
