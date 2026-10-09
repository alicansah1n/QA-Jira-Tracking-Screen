import "server-only";
import { z } from "zod";
import { ISSUE_KEY_PATTERN } from "@/domain/analysis/schema";
import { ReleaseCloseError } from "@/domain/release-close/executor";
import { PROJECT_KEY_PATTERN } from "@/domain/settings/schema";
import { isWeekId } from "@/domain/weekly/week";
import { EnvError } from "@/lib/config/env";
import { JiraSearchLimitError } from "@/lib/jira/api";
import { JiraError, JiraNetworkError, JiraSchemaError, JiraUnknownOutcomeError } from "@/lib/jira/errors";
import { StoreError } from "@/lib/store/json-document";
import { TeamsTargetError } from "@/lib/teams/send";
import { TeamsError } from "@/lib/teams/webhook";
import { BodyError } from "./body";

export type ApiError = { code: string; message: string; details?: unknown };

/** Uygulama içi, kullanıcıya gösterilebilir hata. */
export class AppError extends Error {
  // Next aynı modülü farklı paketlerde (sayfa / route) ayrı kopyalar olarak yükleyebilir; o zaman
  // `instanceof` kopyalar arasında tutmaz. Kontrol sınıf adına göre yapılır.
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null && (value as { name?: unknown }).name === "AppError";
  }

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** Route gövdesini çalıştırır; hataları güvenli JSON cevaba çevirir. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    return errorResponse(error);
  }
}

export function issueKeyParam(raw: string): string {
  const key = raw.toUpperCase();
  if (!ISSUE_KEY_PATTERN.test(key)) throw new AppError(400, "BAD_REQUEST", "Geçersiz madde anahtarı");
  return key;
}

export function projectKeyParam(raw: string | null): string {
  const key = (raw ?? "").toUpperCase();
  if (!PROJECT_KEY_PATTERN.test(key)) throw new AppError(400, "BAD_REQUEST", "Geçersiz proje anahtarı");
  return key;
}

/** "2026-W41" biçiminde ISO hafta. */
export function weekParam(raw: string | null): string {
  const week = (raw ?? "").toUpperCase();
  if (!isWeekId(week)) throw new AppError(400, "BAD_REQUEST", "Geçersiz hafta");
  return week;
}

export function idParam(raw: string): string {
  if (!/^\d{1,18}$/.test(raw)) throw new AppError(400, "BAD_REQUEST", "Geçersiz kimlik");
  return raw;
}

/** Hataları istemciye gönderilecek güvenli bir biçime çevirir. Sırlar ve yığın izi dışarı çıkmaz. */
export function errorResponse(error: unknown): Response {
  const [status, body] = toApiError(error);
  if (status >= 500) console.error("[api]", error);
  return Response.json({ error: body }, { status });
}

function toApiError(error: unknown): [number, ApiError] {
  if (error instanceof AppError) return [error.status, { code: error.code, message: error.message, details: error.details }];
  if (error instanceof EnvError) {
    return [503, { code: "ENV", message: "Ayar dosyası (.env.local) eksik veya hatalı", details: error.issues }];
  }
  if (error instanceof ReleaseCloseError) {
    return [error.code === "BLOCKED" ? 422 : 409, { code: error.code, message: error.message, details: error.details }];
  }
  if (error instanceof JiraError) {
    if (error.status === 401) {
      return [
        502,
        {
          code: "JIRA_AUTH",
          message:
            "Jira kimlik doğrulaması başarısız. JIRA_EMAIL, token'ı oluşturan Atlassian hesabının e-postası olmalı ve token iptal edilmemiş olmalı.",
        },
      ];
    }
    if (error.status === 403) return [502, { code: "JIRA_FORBIDDEN", message: `Jira bu işlem için yetkiniz olmadığını söylüyor. ${error.message}` }];
    if (error.status === 404) return [404, { code: "JIRA_NOT_FOUND", message: "Jira'da bulunamadı ya da görüntüleme yetkiniz yok." }];
    return [502, { code: "JIRA", message: error.message }];
  }
  if (error instanceof JiraNetworkError) {
    const message = error.timedOut
      ? "Jira zamanında cevap vermedi. Bağlantınızı (VPN) kontrol edip tekrar deneyin."
      : "Jira'ya ulaşılamadı. JIRA_BASE_URL adresini ve ağ/VPN bağlantınızı kontrol edin.";
    return [502, { code: "JIRA_NETWORK", message }];
  }
  if (error instanceof JiraUnknownOutcomeError) {
    return [502, { code: "JIRA_UNKNOWN", message: "Jira zamanında cevap vermedi; işlemin uygulanıp uygulanmadığını Jira'da kontrol edin." }];
  }
  if (error instanceof JiraSchemaError) return [502, { code: "JIRA_SCHEMA", message: error.message }];
  if (error instanceof JiraSearchLimitError) return [502, { code: "JIRA_SEARCH", message: error.message }];
  if (error instanceof TeamsTargetError) return [422, { code: "TEAMS_TARGET", message: error.message }];
  if (error instanceof TeamsError) return [502, { code: "TEAMS", message: error.message }];
  if (error instanceof StoreError) return [500, { code: "STORE", message: error.message }];
  if (error instanceof BodyError) return [error.status, { code: "BAD_REQUEST", message: error.message }];
  if (error instanceof z.ZodError || (error as { name?: unknown } | null)?.name === "ZodError") {
    return [400, { code: "BAD_REQUEST", message: "Geçersiz istek", details: z.flattenError(error as z.ZodError).fieldErrors }];
  }
  return [500, { code: "INTERNAL", message: "Beklenmeyen bir hata oluştu" }];
}
