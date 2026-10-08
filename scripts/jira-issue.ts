/**
 * Kullanım: npm run jira:issue -- PROJ-123
 *
 * Maddeyi Jira'dan (salt okuma) alıp Markdown olarak standart çıktıya yazar.
 * Claude Code'daki /jira-analiz komutu maddeyi bu çıktıdan okur. `.env.local` kullanılır.
 */
import nextEnv from "@next/env";
import { ISSUE_KEY_PATTERN } from "@/domain/analysis/schema";
import { EnvError } from "@/lib/config/env";
import { JiraError } from "@/lib/jira/errors";
import { getIssueForAnalysis, issueToMarkdown } from "@/lib/jira/issue";
import { getContext } from "@/lib/server/context";

nextEnv.loadEnvConfig(process.cwd());

async function main() {
  const key = process.argv[2]?.trim().toUpperCase();
  if (!key || !ISSUE_KEY_PATTERN.test(key)) {
    console.error("Kullanım: npm run jira:issue -- PROJ-123");
    process.exit(2);
  }

  const ctx = getContext();
  const { jira, settings } = ctx;
  // Geçersiz kimlikte Jira bazı uçlarda anonim cevap verir; önce oturum doğrulanır.
  await ctx.myself();
  const saved = await settings.read();
  const issue = await getIssueForAnalysis(jira, key, saved.fields.developer?.id);
  process.stdout.write(`${issueToMarkdown(issue)}\n`);
}

main().catch((error: unknown) => {
  if (error instanceof EnvError) {
    console.error(`.env.local eksik veya hatalı: ${error.issues.map((i) => `${i.key} (${i.message})`).join(", ")}`);
  } else if (error instanceof JiraError && error.status === 404) {
    console.error("Madde bulunamadı ya da görüntüleme yetkiniz yok.");
  } else if (error instanceof JiraError && error.status === 401) {
    console.error("Jira kimlik doğrulaması başarısız: JIRA_EMAIL / JIRA_API_TOKEN kontrol edin.");
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
