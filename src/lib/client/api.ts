"use client";

import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/security/request-guard";

export type ApiErrorBody = { code: string; message: string; details?: unknown };

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
    this.name = "ApiRequestError";
  }
}

function csrfToken(): string | undefined {
  return document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${CSRF_COOKIE}=`))
    ?.slice(CSRF_COOKIE.length + 1);
}

/** Uygulamanın kendi API'sine istek. Durum değiştiren isteklere CSRF başlığı eklenir. */
/** `keepalive`: sayfadan ayrılırken de tamamlanması gereken istekler (ör. son değişikliği kaydetmek). */
export async function api<T>(path: string, init: { method?: string; json?: unknown; keepalive?: boolean } = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") {
    const token = csrfToken();
    if (token) headers[CSRF_HEADER] = token;
  }
  if (init.json !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(path, {
    method,
    headers,
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
    credentials: "same-origin",
    keepalive: init.keepalive,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const body = (data as { error?: ApiErrorBody }).error ?? { code: "HTTP", message: `İstek başarısız (${response.status})` };
    throw new ApiRequestError(response.status, body);
  }
  return data as T;
}
