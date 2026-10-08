import { describe, expect, it } from "vitest";
import { evaluateRequest, hostnameOf, newCsrfToken, type GuardInput } from "@/lib/security/request-guard";

const base: GuardInput = {
  method: "GET",
  pathname: "/",
  host: "localhost:3000",
  origin: null,
  secFetchSite: null,
  csrfCookie: undefined,
  csrfHeader: null,
};

const write = (over: Partial<GuardInput> = {}): GuardInput => ({
  ...base,
  method: "PUT",
  pathname: "/api/settings",
  origin: "http://localhost:3000",
  secFetchSite: "same-origin",
  csrfCookie: "tok",
  csrfHeader: "tok",
  ...over,
});

describe("hostnameOf", () => {
  it("port ve IPv6 köşeli parantezlerini doğru ayırır", () => {
    expect(hostnameOf("localhost:3000")).toBe("localhost");
    expect(hostnameOf("127.0.0.1")).toBe("127.0.0.1");
    expect(hostnameOf("[::1]:3000")).toBe("[::1]");
    expect(hostnameOf("LOCALHOST:1")).toBe("localhost");
  });
});

describe("evaluateRequest", () => {
  it("loopback dışı Host'u reddeder (DNS rebinding)", () => {
    for (const host of ["evil.example", "evil.example:3000", "localhost.evil.example", "127.0.0.1.nip.io", null]) {
      expect(evaluateRequest({ ...base, host }).ok).toBe(false);
    }
  });

  it("loopback Host ile sayfa isteklerine izin verir", () => {
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
      expect(evaluateRequest({ ...base, host }).ok).toBe(true);
    }
  });

  it("API okumalarında cross-site istekleri reddeder", () => {
    expect(evaluateRequest({ ...base, pathname: "/api/settings", secFetchSite: "cross-site" }).ok).toBe(false);
    expect(evaluateRequest({ ...base, pathname: "/api/settings", secFetchSite: "same-origin" }).ok).toBe(true);
  });

  it("geçerli yazma isteğine izin verir", () => {
    expect(evaluateRequest(write())).toEqual({ ok: true });
  });

  it("Origin yoksa ya da farklıysa yazmayı reddeder", () => {
    expect(evaluateRequest(write({ origin: null })).ok).toBe(false);
    expect(evaluateRequest(write({ origin: "https://evil.example" })).ok).toBe(false);
    expect(evaluateRequest(write({ origin: "http://localhost:4000" })).ok).toBe(false);
    expect(evaluateRequest(write({ origin: "null" })).ok).toBe(false);
  });

  it("CSRF çerezi ile başlığı eşleşmezse yazmayı reddeder", () => {
    expect(evaluateRequest(write({ csrfHeader: null })).ok).toBe(false);
    expect(evaluateRequest(write({ csrfCookie: undefined })).ok).toBe(false);
    expect(evaluateRequest(write({ csrfHeader: "baska" })).ok).toBe(false);
  });

  it("/api dışındaki yazma isteklerinde de Origin ve CSRF ister", () => {
    expect(evaluateRequest(write({ pathname: "/releases/close", csrfHeader: null })).ok).toBe(false);
    expect(evaluateRequest(write({ pathname: "/foo", origin: null })).ok).toBe(false);
    expect(evaluateRequest(write({ pathname: "/foo" })).ok).toBe(true);
  });

  it("method büyük/küçük harfinden etkilenmez", () => {
    expect(evaluateRequest(write({ method: "post", csrfHeader: null })).ok).toBe(false);
  });
});

describe("newCsrfToken", () => {
  it("64 karakterlik hex ve her seferinde farklı", () => {
    const a = newCsrfToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newCsrfToken()).not.toBe(a);
  });
});
