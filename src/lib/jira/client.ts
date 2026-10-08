import "server-only";
import type { z } from "zod";
import { createLimiter, DEFAULT_RETRY, isRetryableStatus, retryDelay, type RetryPolicy } from "@/lib/http/retry";
import { JiraError, JiraNetworkError, JiraSchemaError, JiraUnknownOutcomeError, type JiraErrorBody } from "./errors";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

type QueryValue = string | number | boolean | undefined | readonly string[];

export type RequestOptions<T> = {
  query?: Record<string, QueryValue>;
  /** JSON olarak gönderilir. */
  json?: unknown;
  /** Ham gövde (ör. ek yükleme için FormData). Content-Type fetch tarafından belirlenir. */
  body?: BodyInit;
  headers?: Record<string, string>;
  schema?: z.ZodType<T>;
  /** Yan etkisi olmayan POST (ör. JQL arama): okuma gibi tekrar denenir. */
  idempotent?: boolean;
};

export type JiraClientOptions = {
  baseUrl: string;
  email: string;
  apiToken: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  retry?: RetryPolicy;
  concurrency?: number;
  timeoutMs?: number;
};

export type JiraClient = ReturnType<typeof createJiraClient>;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createJiraClient(options: JiraClientOptions) {
  const base = new URL(options.baseUrl);
  if (base.protocol !== "https:") throw new Error("Jira adresi https olmalı");

  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const policy = options.retry ?? DEFAULT_RETRY;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const limit = createLimiter(options.concurrency ?? 4);
  const authorization = `Basic ${Buffer.from(`${options.email}:${options.apiToken}`).toString("base64")}`;

  function buildUrl(path: string, query?: Record<string, QueryValue>): URL {
    if (!path.startsWith("/rest/")) throw new Error(`Geçersiz Jira yolu: ${path}`);
    const url = new URL(path, base);
    // Yol, kimlik bilgilerinin başka bir sunucuya gitmesine yol açmamalı.
    if (url.origin !== base.origin) throw new Error(`Geçersiz Jira yolu: ${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined) continue;
      if (Array.isArray(value)) for (const v of value) url.searchParams.append(key, v);
      else url.searchParams.set(key, String(value));
    }
    return url;
  }

  async function request<T = unknown>(method: HttpMethod, path: string, opts: RequestOptions<T> = {}): Promise<T> {
    const isWrite = method !== "GET" && !opts.idempotent;
    const url = buildUrl(path, opts.query);
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...opts.headers,
      Authorization: authorization,
    };
    let body: BodyInit | undefined = opts.body;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    }

    for (let attempt = 0; ; attempt++) {
      let response: Response;
      // Zaman aşımı yalnızca cevap başlıkları gelene kadar sayılır; gövde okunurken iptal edilen
      // bir yazma, uygulanmış olduğu halde başarısız görünürdü.
      // Sayaç, eşzamanlılık kuyruğunda beklerken değil istek gönderilirken başlar.
      const controller = new AbortController();
      try {
        response = await limit(async () => {
          const timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), timeoutMs);
          try {
            return await doFetch(url, { method, headers, body, signal: controller.signal, redirect: "error" });
          } finally {
            clearTimeout(timer);
          }
        });
      } catch (cause) {
        if (isWrite) throw new JiraUnknownOutcomeError(method, path, cause);
        if (attempt + 1 >= policy.maxAttempts) {
          throw new JiraNetworkError(method, path, controller.signal.aborted, cause);
        }
        await sleep(retryDelay(attempt, null, policy, options.random) ?? 0);
        continue;
      }

      if (response.ok) return parse(response, path, opts.schema, isWrite);

      if (isRetryableStatus(response.status, isWrite) && attempt + 1 < policy.maxAttempts) {
        const delay = retryDelay(attempt, response.headers.get("Retry-After"), policy, options.random);
        if (delay !== undefined) {
          await response.body?.cancel();
          await sleep(delay);
          continue;
        }
      }

      if (isWrite && response.status >= 500) {
        throw new JiraUnknownOutcomeError(method, path, new JiraError(response.status, method, path, await readError(response)));
      }
      throw new JiraError(response.status, method, path, await readError(response));
    }
  }

  return {
    request,
    get: <T>(path: string, opts?: Omit<RequestOptions<T>, "json" | "body">) => request<T>("GET", path, opts),
    post: <T>(path: string, opts?: RequestOptions<T>) => request<T>("POST", path, opts),
    put: <T>(path: string, opts?: RequestOptions<T>) => request<T>("PUT", path, opts),
    delete: <T>(path: string, opts?: RequestOptions<T>) => request<T>("DELETE", path, opts),
    baseUrl: base.origin,
  };
}

async function parse<T>(response: Response, path: string, schema: z.ZodType<T> | undefined, committed: boolean): Promise<T> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new JiraSchemaError(path, "cevap okunamadı", committed);
  }
  if (!text) return undefined as T;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new JiraSchemaError(path, "JSON değil", committed);
  }
  if (!schema) return data as T;
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new JiraSchemaError(path, first ? `${first.path.join(".") || "(kök)"}: ${first.message}` : "geçersiz", committed);
  }
  return result.data;
}

async function readError(response: Response): Promise<JiraErrorBody | undefined> {
  try {
    const data = (await response.json()) as JiraErrorBody;
    return { errorMessages: data.errorMessages, errors: data.errors };
  } catch {
    return undefined;
  }
}
