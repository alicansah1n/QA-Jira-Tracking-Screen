import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { JiraError, JiraNetworkError, JiraSchemaError, JiraUnknownOutcomeError } from "@/lib/jira/errors";
import { JIRA, testClient } from "../../helpers/jira";
import { server } from "../../helpers/msw";

describe("Jira istemcisi", () => {
  it("Basic auth başlığını gönderir ve JSON'u şemayla doğrular", async () => {
    let auth: string | null = null;
    server.use(
      http.get(`${JIRA}/rest/api/3/myself`, ({ request }) => {
        auth = request.headers.get("authorization");
        return HttpResponse.json({ accountId: "abc", displayName: "QA", extra: 1 });
      }),
    );
    const { jira } = testClient();
    const me = await jira.get("/rest/api/3/myself", { schema: z.looseObject({ accountId: z.string() }) });
    expect(me.accountId).toBe("abc");
    expect(auth).toBe(`Basic ${Buffer.from("qa@example.com:secret-token").toString("base64")}`);
  });

  it("sorgu parametrelerini ve dizileri ekler", async () => {
    let url: URL | undefined;
    server.use(
      http.get(`${JIRA}/rest/api/3/thing`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({});
      }),
    );
    await testClient().jira.get("/rest/api/3/thing", { query: { a: "x y", b: 2, c: undefined, d: ["1", "2"] } });
    expect(url?.searchParams.get("a")).toBe("x y");
    expect(url?.searchParams.get("b")).toBe("2");
    expect(url?.searchParams.has("c")).toBe(false);
    expect(url?.searchParams.getAll("d")).toEqual(["1", "2"]);
  });

  it("okumada 503 sonrası tekrar dener", async () => {
    let calls = 0;
    server.use(
      http.get(`${JIRA}/rest/api/3/myself`, () => {
        calls++;
        return calls < 3 ? new HttpResponse(null, { status: 503 }) : HttpResponse.json({ ok: true });
      }),
    );
    const { jira, sleep } = testClient();
    await expect(jira.get("/rest/api/3/myself")).resolves.toEqual({ ok: true });
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("429'da Retry-After süresi kadar bekler", async () => {
    let calls = 0;
    server.use(
      http.get(`${JIRA}/rest/api/3/myself`, () => {
        calls++;
        return calls === 1
          ? new HttpResponse(null, { status: 429, headers: { "Retry-After": "7" } })
          : HttpResponse.json({});
      }),
    );
    const { jira, sleep } = testClient();
    await jira.get("/rest/api/3/myself");
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it("deneme hakkı bitince son hatayı fırlatır", async () => {
    server.use(http.get(`${JIRA}/rest/api/3/myself`, () => new HttpResponse(null, { status: 503 })));
    const { jira } = testClient();
    const error = await jira.get("/rest/api/3/myself").catch((e) => e);
    expect(error).toBeInstanceOf(JiraError);
    expect((error as JiraError).status).toBe(503);
  });

  it("yazmada 5xx tekrar denenmez ve sonucu bilinmiyor sayılır", async () => {
    let calls = 0;
    server.use(
      http.post(`${JIRA}/rest/api/3/issue/A-1/comment`, () => {
        calls++;
        return new HttpResponse(null, { status: 503 });
      }),
    );
    const { jira } = testClient();
    await expect(jira.post("/rest/api/3/issue/A-1/comment", { json: {} })).rejects.toBeInstanceOf(JiraUnknownOutcomeError);
    expect(calls).toBe(1);
  });

  it("yazmada 429 tekrar denenir (istek işlenmemiştir)", async () => {
    let calls = 0;
    server.use(
      http.post(`${JIRA}/rest/api/3/issue/A-1/comment`, () => {
        calls++;
        return calls === 1 ? new HttpResponse(null, { status: 429 }) : HttpResponse.json({ id: "10" }, { status: 201 });
      }),
    );
    await expect(testClient().jira.post("/rest/api/3/issue/A-1/comment", { json: {} })).resolves.toEqual({ id: "10" });
    expect(calls).toBe(2);
  });

  it("yazmada ağ hatası sonucu bilinmiyor sayılır", async () => {
    server.use(http.put(`${JIRA}/rest/api/3/version/1`, () => HttpResponse.error()));
    await expect(testClient().jira.put("/rest/api/3/version/1", { json: {} })).rejects.toBeInstanceOf(
      JiraUnknownOutcomeError,
    );
  });

  it("idempotent POST okuma gibi tekrar denenir", async () => {
    let calls = 0;
    server.use(
      http.post(`${JIRA}/rest/api/3/search/jql`, () => {
        calls++;
        return calls === 1 ? new HttpResponse(null, { status: 502 }) : HttpResponse.json({ issues: [] });
      }),
    );
    await testClient().jira.post("/rest/api/3/search/jql", { json: {}, idempotent: true });
    expect(calls).toBe(2);
  });

  it("4xx'te Jira hata mesajlarını taşır, tekrar denemez", async () => {
    let calls = 0;
    server.use(
      http.get(`${JIRA}/rest/api/3/issue/X-1`, () => {
        calls++;
        return HttpResponse.json({ errorMessages: ["Issue does not exist"] }, { status: 404 });
      }),
    );
    const error = (await testClient().jira.get("/rest/api/3/issue/X-1").catch((e) => e)) as JiraError;
    expect(error).toBeInstanceOf(JiraError);
    expect(error.status).toBe(404);
    expect(error.message).toContain("Issue does not exist");
    expect(calls).toBe(1);
  });

  it("hata mesajında API token yer almaz", async () => {
    server.use(http.get(`${JIRA}/rest/api/3/myself`, () => new HttpResponse(null, { status: 401 })));
    const error = (await testClient().jira.get("/rest/api/3/myself").catch((e) => e)) as Error;
    expect(error.message).not.toContain("secret-token");
    expect(JSON.stringify(error)).not.toContain("secret-token");
  });

  it("şemaya uymayan cevapta JiraSchemaError fırlatır", async () => {
    server.use(http.get(`${JIRA}/rest/api/3/myself`, () => HttpResponse.json({ accountId: 5 })));
    await expect(
      testClient().jira.get("/rest/api/3/myself", { schema: z.object({ accountId: z.string() }) }),
    ).rejects.toBeInstanceOf(JiraSchemaError);
  });

  it("204 cevabında undefined döner", async () => {
    server.use(http.post(`${JIRA}/rest/api/3/issue/A-1/transitions`, () => new HttpResponse(null, { status: 204 })));
    await expect(testClient().jira.post("/rest/api/3/issue/A-1/transitions", { json: {} })).resolves.toBeUndefined();
  });

  it("kimlik bilgilerini başka sunucuya gönderebilecek yolları reddeder", async () => {
    const { jira } = testClient();
    await expect(jira.get("https://evil.example/rest/api/3/myself")).rejects.toThrow("Geçersiz Jira yolu");
    await expect(jira.get("//evil.example/rest/api/3/myself")).rejects.toThrow("Geçersiz Jira yolu");
    await expect(jira.get("/wiki/api")).rejects.toThrow("Geçersiz Jira yolu");
  });

  it("https olmayan Jira adresini kabul etmez", () => {
    expect(() => testClient({ baseUrl: "http://test.atlassian.net" })).toThrow("https");
  });
});

describe("Jira istemcisi — sonuç belirsizliği ve ağ hataları", () => {
  it("2xx yazmanın cevabı çözülemezse committed=true işaretler (tekrar gönderilmemeli)", async () => {
    server.use(http.post(`${JIRA}/rest/api/3/issue/A-1/comment`, () => new HttpResponse("<html>", { status: 201 })));
    const error = (await testClient()
      .jira.post("/rest/api/3/issue/A-1/comment", { json: {} })
      .catch((e) => e)) as JiraSchemaError;
    expect(error).toBeInstanceOf(JiraSchemaError);
    expect(error.committed).toBe(true);
  });

  it("okumada şema hatası committed=false", async () => {
    server.use(http.get(`${JIRA}/rest/api/3/myself`, () => HttpResponse.json({ accountId: 1 })));
    const error = (await testClient()
      .jira.get("/rest/api/3/myself", { schema: z.object({ accountId: z.string() }) })
      .catch((e) => e)) as JiraSchemaError;
    expect(error.committed).toBe(false);
  });

  it("okumada ağ hatası denemeler bitince JiraNetworkError olur", async () => {
    let calls = 0;
    server.use(
      http.get(`${JIRA}/rest/api/3/myself`, () => {
        calls++;
        return HttpResponse.error();
      }),
    );
    const error = await testClient().jira.get("/rest/api/3/myself").catch((e) => e);
    expect(error).toBeInstanceOf(JiraNetworkError);
    expect(calls).toBe(4);
  });

  it("Retry-After üst sınırı aşıyorsa beklemeden 429 ile vazgeçer", async () => {
    let calls = 0;
    server.use(
      http.get(`${JIRA}/rest/api/3/myself`, () => {
        calls++;
        return new HttpResponse(null, { status: 429, headers: { "Retry-After": "600" } });
      }),
    );
    const { jira, sleep } = testClient();
    const error = (await jira.get("/rest/api/3/myself").catch((e) => e)) as JiraError;
    expect(error.status).toBe(429);
    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
