export type RetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 4, baseDelayMs: 1000, maxDelayMs: 30_000 };

const READ_RETRY_STATUSES = new Set([429, 502, 503, 504]);

/**
 * Okumalar geçici hatalarda tekrar denenir. Yazmalar yalnızca 429'da tekrar denenir:
 * 429'da Jira isteği işlemeden reddetmiştir; 5xx'te ise işlemin yapılıp yapılmadığı bilinmez.
 */
export function isRetryableStatus(status: number, isWrite: boolean): boolean {
  return isWrite ? status === 429 : READ_RETRY_STATUSES.has(status);
}

/** `Retry-After` başlığını (saniye ya da HTTP tarihi) milisaniyeye çevirir. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

/** Tam jitter'lı üstel bekleme: [0, min(max, base * 2^attempt)] */
export function backoffDelay(attempt: number, policy: RetryPolicy, random: () => number = Math.random): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

/**
 * Bir sonraki denemeden önce beklenecek süre. Sunucu üst sınırdan uzun beklenmesini isterse
 * `undefined` döner: erken denemek yalnızca yeni bir 429 getirir, çağıran hemen vazgeçmelidir.
 */
export function retryDelay(
  attempt: number,
  retryAfterHeader: string | null,
  policy: RetryPolicy,
  random?: () => number,
): number | undefined {
  const fromHeader = parseRetryAfter(retryAfterHeader);
  if (fromHeader !== undefined) return fromHeader <= policy.maxDelayMs ? fromHeader : undefined;
  return backoffDelay(attempt, policy, random);
}

/** Aynı anda en fazla `limit` işin çalışmasını sağlayan basit semafor. */
export function createLimiter(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  // Boşalan slot sayaç düşürülmeden doğrudan sıradakine devredilir; aksi halde
  // araya giren yeni bir çağrı limiti aşabilir.
  const release = () => {
    const next = queue.shift();
    if (next) next();
    else active--;
  };

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active < limit) active++;
    else await new Promise<void>((resolve) => queue.push(resolve));
    try {
      return await task();
    } finally {
      release();
    }
  };
}
