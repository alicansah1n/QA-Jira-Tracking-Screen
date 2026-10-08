import { describe, expect, it } from "vitest";
import { backoffDelay, createLimiter, DEFAULT_RETRY, isRetryableStatus, parseRetryAfter, retryDelay } from "@/lib/http/retry";

describe("isRetryableStatus", () => {
  it("okumalarda 429 ve geçici 5xx tekrar denenir", () => {
    for (const s of [429, 502, 503, 504]) expect(isRetryableStatus(s, false)).toBe(true);
    for (const s of [400, 401, 403, 404, 500]) expect(isRetryableStatus(s, false)).toBe(false);
  });

  it("yazmalarda yalnızca 429 tekrar denenir", () => {
    expect(isRetryableStatus(429, true)).toBe(true);
    for (const s of [500, 502, 503, 504]) expect(isRetryableStatus(s, true)).toBe(false);
  });
});

describe("parseRetryAfter", () => {
  it("saniye değerini milisaniyeye çevirir", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter("0")).toBe(0);
  });

  it("HTTP tarihini kalan süreye çevirir", () => {
    const now = Date.parse("2026-10-07T10:00:00Z");
    expect(parseRetryAfter("Wed, 07 Oct 2026 10:00:05 GMT", now)).toBe(5000);
    expect(parseRetryAfter("Wed, 07 Oct 2026 09:59:00 GMT", now)).toBe(0);
  });

  it("geçersiz ya da boş değerde undefined döner", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("yakında")).toBeUndefined();
  });
});

describe("backoffDelay / retryDelay", () => {
  it("üst sınırı aşmaz", () => {
    expect(backoffDelay(10, DEFAULT_RETRY, () => 0.999)).toBeLessThanOrEqual(DEFAULT_RETRY.maxDelayMs);
    expect(backoffDelay(0, DEFAULT_RETRY, () => 0.5)).toBe(500);
    expect(backoffDelay(2, DEFAULT_RETRY, () => 0.5)).toBe(2000);
  });

  it("Retry-After varsa onu kullanır; üst sınırı aşıyorsa vazgeçilmesini söyler", () => {
    expect(retryDelay(0, "2", DEFAULT_RETRY)).toBe(2000);
    expect(retryDelay(0, "30", DEFAULT_RETRY)).toBe(30_000);
    expect(retryDelay(0, "3600", DEFAULT_RETRY)).toBeUndefined();
  });
});

describe("createLimiter", () => {
  it("aynı anda limitten fazla iş çalıştırmaz", async () => {
    const run = createLimiter(2);
    let active = 0;
    let peak = 0;
    const task = () =>
      run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      });
    await Promise.all(Array.from({ length: 10 }, task));
    expect(peak).toBe(2);
  });

  it("hata fırlatan iş slotu serbest bırakır", async () => {
    const run = createLimiter(1);
    await expect(run(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await expect(run(async () => "devam")).resolves.toBe("devam");
  });
});
