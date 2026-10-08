export type JiraErrorBody = {
  errorMessages?: string[];
  errors?: Record<string, string>;
};

/** Jira'nın döndürdüğü kesin hata (istek işlenmedi ya da reddedildi). */
export class JiraError extends Error {
  // Next aynı modülü farklı paketlerde (sayfa / route) ayrı kopyalar olarak yükleyebilir; o zaman
  // `instanceof` kopyalar arasında tutmaz. Kontrol sınıf adına göre yapılır.
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null && (value as { name?: unknown }).name === "JiraError";
  }

  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: JiraErrorBody | undefined,
  ) {
    super(`Jira ${method} ${path} → ${status}${describe(body)}`);
    this.name = "JiraError";
  }
}

/**
 * Yazma isteğinin sonucu bilinmiyor (zaman aşımı, ağ hatası, 5xx).
 * Çağıran, Jira'nın gerçek durumunu okuyup karar vermelidir; isteği körlemesine tekrarlamamalıdır.
 */
export class JiraUnknownOutcomeError extends Error {
  // Next aynı modülü farklı paketlerde (sayfa / route) ayrı kopyalar olarak yükleyebilir; o zaman
  // `instanceof` kopyalar arasında tutmaz. Kontrol sınıf adına göre yapılır.
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null && (value as { name?: unknown }).name === "JiraUnknownOutcomeError";
  }

  constructor(
    readonly method: string,
    readonly path: string,
    readonly cause: unknown,
  ) {
    super(`Jira ${method} ${path} sonucu bilinmiyor`);
    this.name = "JiraUnknownOutcomeError";
  }
}

/**
 * Jira cevabı beklenen biçimde değil ya da okunamadı.
 * `committed: true` ise istek bir yazmaydı ve Jira 2xx döndü: değişiklik **uygulandı**,
 * yalnızca cevap çözülemedi. Çağıran bunu başarısızlık sayıp tekrar göndermemelidir.
 */
export class JiraSchemaError extends Error {
  // Next aynı modülü farklı paketlerde (sayfa / route) ayrı kopyalar olarak yükleyebilir; o zaman
  // `instanceof` kopyalar arasında tutmaz. Kontrol sınıf adına göre yapılır.
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null && (value as { name?: unknown }).name === "JiraSchemaError";
  }

  constructor(
    readonly path: string,
    readonly detail: string,
    readonly committed = false,
  ) {
    super(`Jira ${path} cevabı beklenen biçimde değil: ${detail}`);
    this.name = "JiraSchemaError";
  }
}

/** Jira'ya ulaşılamadı (ağ hatası, zaman aşımı, yönlendirme). Yalnızca okumalarda kullanılır. */
export class JiraNetworkError extends Error {
  // Next aynı modülü farklı paketlerde (sayfa / route) ayrı kopyalar olarak yükleyebilir; o zaman
  // `instanceof` kopyalar arasında tutmaz. Kontrol sınıf adına göre yapılır.
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null && (value as { name?: unknown }).name === "JiraNetworkError";
  }

  constructor(
    readonly method: string,
    readonly path: string,
    readonly timedOut: boolean,
    readonly cause: unknown,
  ) {
    super(timedOut ? `Jira ${method} ${path} zaman aşımına uğradı` : `Jira'ya ulaşılamadı (${method} ${path})`);
    this.name = "JiraNetworkError";
  }
}

function describe(body: JiraErrorBody | undefined): string {
  if (!body) return "";
  const parts = [...(body.errorMessages ?? []), ...Object.entries(body.errors ?? {}).map(([k, v]) => `${k}: ${v}`)];
  return parts.length ? ` (${parts.join("; ")})` : "";
}
