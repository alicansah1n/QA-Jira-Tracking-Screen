import "server-only";
import path from "node:path";
import { z } from "zod";
import "@/lib/zod-locale";

const EnvSchema = z.object({
  JIRA_BASE_URL: z
    .url({ protocol: /^https$/, error: "https ile başlayan bir adres olmalı" })
    .transform((u) => u.replace(/\/+$/, "")),
  JIRA_EMAIL: z.email({ error: "Geçerli bir e-posta olmalı" }),
  JIRA_API_TOKEN: z.string().min(1, "Boş olamaz"),
  DATA_DIR: z.string().default("./data"),
});

export type AppEnv = z.infer<typeof EnvSchema>;

export type EnvResult =
  | { ok: true; env: AppEnv }
  | { ok: false; issues: { key: string; message: string }[] };

/** Ortam değişkenlerini doğrular. Sırların değerleri hiçbir zaman hata mesajına konmaz. */
export function loadEnv(source: Record<string, string | undefined> = process.env): EnvResult {
  const parsed = EnvSchema.safeParse(source);
  if (parsed.success) return { ok: true, env: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => ({
      key: String(i.path[0] ?? "?"),
      message: source[String(i.path[0])] ? i.message : "Tanımlı değil",
    })),
  };
}

export function requireEnv(): AppEnv {
  const result = loadEnv();
  if (!result.ok) {
    throw new EnvError(result.issues);
  }
  return result.env;
}

export function dataDir(env: Pick<AppEnv, "DATA_DIR">): string {
  // Veri klasörü çalışma anında belirlenir; derleme çıktısına dahil edilmemeli.
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), env.DATA_DIR);
}

export class EnvError extends Error {
  // Next aynı modülü farklı paketlerde (sayfa / route) ayrı kopyalar olarak yükleyebilir; o zaman
  // `instanceof` kopyalar arasında tutmaz. Kontrol sınıf adına göre yapılır.
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null && (value as { name?: unknown }).name === "EnvError";
  }

  constructor(readonly issues: { key: string; message: string }[]) {
    super(`Eksik veya hatalı ayar: ${issues.map((i) => i.key).join(", ")}`);
    this.name = "EnvError";
  }
}
