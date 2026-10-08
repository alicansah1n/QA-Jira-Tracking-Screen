import "server-only";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { createAnalysisStore, type AnalysisStore } from "@/domain/analysis/store";
import { ISSUE_KEY_PATTERN } from "@/domain/analysis/schema";
import { InboxSeenSchema, LEDGER_VERSION, LedgerSchema, type InboxSeen, type Ledger } from "@/domain/inbox/ledger";
import { JOURNAL_VERSION, JournalSchema, type Journal } from "@/domain/release-close/journal";
import { SETTINGS_VERSION, SettingsSchema, defaultSettings, type Settings } from "@/domain/settings/schema";
import { TEST_RUN_VERSION, TestRunSchema, type TestRun } from "@/domain/testrun/schema";
import { dataDir, loadEnv, requireEnv, type AppEnv } from "@/lib/config/env";
import { getMyself } from "@/lib/jira/api";
import { createJiraClient, type JiraClient } from "@/lib/jira/client";
import type { Myself } from "@/lib/jira/schemas";
import { createJsonDocument, type JsonDocument } from "@/lib/store/json-document";
import { trustSystemCertificates } from "./system-ca";

/**
 * Sunucu tarafı bağımlılıkların tek giriş noktası. Next dev modunda modüller yeniden
 * yüklenebildiği için örnekler `globalThis` üzerinde tutulur. Ortam değişkenleri değişirse
 * (ör. token yenilendi) bağlam yeniden kurulur.
 */
export type Context = {
  env: AppEnv;
  jira: JiraClient;
  settings: JsonDocument<Settings>;
  ledger: JsonDocument<Ledger>;
  inboxSeen: JsonDocument<InboxSeen>;
  run(issueKey: string): JsonDocument<TestRun | null>;
  journal(runId: string): JsonDocument<Journal | null>;
  listJournalIds(): Promise<string[]>;
  /**
   * Oturumu açık kullanıcı. Jira Cloud geçersiz kimlikle gelen bazı istekleri anonim kullanıcı gibi
   * cevaplar (ör. boş arama sonucu); bu yüzden Jira'dan okuyan her akış önce bunu çağırır.
   */
  myself(): Promise<Myself>;
};

type Holder = {
  __qaContext?: { fingerprint: string; context: Context };
  __qaAnalyses?: { dir: string; store: AnalysisStore };
};

const holder = globalThis as unknown as Holder;

function analysesDir(): string {
  return path.join(dataDir({ DATA_DIR: process.env.DATA_DIR ?? "./data" }), "analyses");
}

/** Jira bağlantısı gerektiren işler için bağlam. `.env.local` eksikse `EnvError` fırlatır. */
export function getContext(): Context {
  trustSystemCertificates();
  const env = requireEnv();
  const fingerprint = JSON.stringify(env);
  if (holder.__qaContext?.fingerprint === fingerprint) return holder.__qaContext.context;

  const context = buildContext(env, createJiraClient({ baseUrl: env.JIRA_BASE_URL, email: env.JIRA_EMAIL, apiToken: env.JIRA_API_TOKEN }));
  holder.__qaContext = { fingerprint, context };
  return context;
}

/** Bağlamı verilen ortam ve Jira istemcisiyle kurar (testler sahte Jira ile kullanır). */
export function buildContext(env: AppEnv, jira: JiraClient): Context {
  const dir = dataDir(env);
  const runs = new Map<string, JsonDocument<TestRun | null>>();
  const journals = new Map<string, JsonDocument<Journal | null>>();
  const journalDir = path.join(dir, "journal");
  let me: { value: Myself; at: number } | undefined;

  const context: Context = {
    env,
    jira,
    settings: createJsonDocument({
      file: path.join(dir, "settings.json"),
      schema: SettingsSchema,
      defaults: defaultSettings,
      version: SETTINGS_VERSION,
    }),
    ledger: createJsonDocument({
      file: path.join(dir, "dev-requests.json"),
      schema: LedgerSchema,
      defaults: () => ({ entries: {} }),
      version: LEDGER_VERSION,
    }),
    inboxSeen: createJsonDocument({
      file: path.join(dir, "inbox-seen.json"),
      schema: InboxSeenSchema,
      defaults: () => ({ seen: {} }),
      version: 1,
    }),
    run(issueKey) {
      if (!ISSUE_KEY_PATTERN.test(issueKey)) throw new Error(`Geçersiz madde anahtarı: ${issueKey}`);
      let d = runs.get(issueKey);
      if (!d) {
        d = createJsonDocument({
          file: path.join(dir, "runs", `${issueKey}.json`),
          schema: TestRunSchema.nullable(),
          defaults: () => null,
          version: TEST_RUN_VERSION,
        });
        runs.set(issueKey, d);
      }
      return d;
    },
    journal(runId) {
      if (!/^[a-z0-9-]{8,64}$/.test(runId)) throw new Error(`Geçersiz kayıt kimliği: ${runId}`);
      let d = journals.get(runId);
      if (!d) {
        d = createJsonDocument({
          file: path.join(journalDir, `${runId}.json`),
          schema: JournalSchema.nullable(),
          defaults: () => null,
          version: JOURNAL_VERSION,
        });
        journals.set(runId, d);
      }
      return d;
    },
    async listJournalIds() {
      try {
        return (await readdir(journalDir))
          .filter((n) => n.endsWith(".json") && !n.endsWith(".lock"))
          .map((n) => n.slice(0, -5))
          .filter((id) => /^[a-z0-9-]{8,64}$/.test(id));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    },
    async myself() {
      if (me && Date.now() - me.at < 10 * 60_000) return me.value;
      me = { value: await getMyself(jira), at: Date.now() };
      return me.value;
    },
  };
  return context;
}

/** Analiz dosyaları Jira bilgisi gerektirmez; yalnızca veri klasörü kullanılır. */
export function getAnalysisStore(): AnalysisStore {
  const dir = analysesDir();
  if (holder.__qaAnalyses?.dir === dir) return holder.__qaAnalyses.store;
  const store = createAnalysisStore(dir);
  holder.__qaAnalyses = { dir, store };
  return store;
}

/** Jira ayarlıysa maddenin Jira bağlantısı, değilse undefined. */
export function jiraBrowseUrl(key: string): string | undefined {
  const env = loadEnv();
  return env.ok ? `${env.env.JIRA_BASE_URL}/browse/${encodeURIComponent(key)}` : undefined;
}
