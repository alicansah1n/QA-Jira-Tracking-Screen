/**
 * Localhost'ta çalışan uygulamayı, kullanıcının ziyaret ettiği başka sitelerden gelen isteklere karşı korur.
 *
 * - Host başlığı yalnızca loopback olabilir → DNS rebinding saldırılarını engeller.
 * - Durum değiştiren tüm isteklerde (yoldan bağımsız) Origin aynı olmalı ve CSRF çerezi ile
 *   başlığı eşleşmeli (double-submit; çerez SameSite=Strict).
 * - API okumalarında tarayıcının "cross-site" olarak işaretlediği istekler reddedilir.
 */

export const CSRF_COOKIE = "qa_csrf";
export const CSRF_HEADER = "x-qa-csrf";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type GuardInput = {
  method: string;
  pathname: string;
  host: string | null;
  origin: string | null;
  secFetchSite: string | null;
  csrfCookie: string | undefined;
  csrfHeader: string | null;
};

export type GuardResult = { ok: true } | { ok: false; status: 403; reason: string };

/** "localhost:3000" → "localhost"; "[::1]:3000" → "[::1]" */
export function hostnameOf(host: string): string {
  const value = host.trim().toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end === -1 ? value : value.slice(0, end + 1);
  }
  return value.split(":")[0] ?? value;
}

export function isLoopbackHost(host: string | null): boolean {
  return host !== null && LOOPBACK_HOSTNAMES.has(hostnameOf(host));
}

export function evaluateRequest(input: GuardInput): GuardResult {
  if (!isLoopbackHost(input.host)) {
    return { ok: false, status: 403, reason: "Geçersiz Host" };
  }

  if (SAFE_METHODS.has(input.method.toUpperCase())) {
    const isApi = input.pathname === "/api" || input.pathname.startsWith("/api/");
    if (isApi && input.secFetchSite === "cross-site") {
      return { ok: false, status: 403, reason: "Başka siteden gelen istek" };
    }
    return { ok: true };
  }

  if (!input.origin || !sameOrigin(input.origin, input.host)) {
    return { ok: false, status: 403, reason: "Geçersiz Origin" };
  }
  if (!input.csrfCookie || !input.csrfHeader || !constantTimeEqual(input.csrfCookie, input.csrfHeader)) {
    return { ok: false, status: 403, reason: "CSRF doğrulaması başarısız" };
  }
  return { ok: true };
}

function sameOrigin(origin: string, host: string | null): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && url.host.toLowerCase() === host?.trim().toLowerCase() && isLoopbackHost(url.host);
  } catch {
    return false;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function newCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
