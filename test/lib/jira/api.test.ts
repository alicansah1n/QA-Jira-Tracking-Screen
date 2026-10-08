import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { getMyPermissions, getProjectStatuses, JiraSearchLimitError, searchAll } from "@/lib/jira/api";
import { JIRA, testClient } from "../../helpers/jira";
import { server } from "../../helpers/msw";

const issue = (n: number) => ({ id: String(n), key: `P-${n}`, fields: { summary: `Madde ${n}` } });

describe("searchJql", () => {
  it("nextPageToken ile tüm sayfaları dolaşır ve alanları açıkça ister", async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post(`${JIRA}/rest/api/3/search/jql`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        if (!body.nextPageToken) return HttpResponse.json({ issues: [issue(1), issue(2)], nextPageToken: "t2", isLast: false });
        if (body.nextPageToken === "t2") return HttpResponse.json({ issues: [issue(3)], nextPageToken: "t3", isLast: false });
        return HttpResponse.json({ issues: [issue(4)], isLast: true });
      }),
    );
    const issues = await searchAll(testClient().jira, "project = P", { fields: ["summary"], pageSize: 2 });
    expect(issues.map((i) => i.key)).toEqual(["P-1", "P-2", "P-3", "P-4"]);
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toMatchObject({ jql: "project = P", fields: ["summary"], maxResults: 2 });
    expect(bodies[1]?.nextPageToken).toBe("t2");
  });

  it("maxIssues aşılırsa eksik liste dönmez, hata fırlatır", async () => {
    let calls = 0;
    server.use(
      http.post(`${JIRA}/rest/api/3/search/jql`, () => {
        calls++;
        return HttpResponse.json({ issues: [issue(calls * 2 - 1), issue(calls * 2)], nextPageToken: `t${calls}`, isLast: false });
      }),
    );
    await expect(searchAll(testClient().jira, "x", { fields: [], maxIssues: 3 })).rejects.toBeInstanceOf(JiraSearchLimitError);
  });

  it("tam sınırda biten sonuç hata sayılmaz", async () => {
    server.use(http.post(`${JIRA}/rest/api/3/search/jql`, () => HttpResponse.json({ issues: [issue(1), issue(2)], isLast: true })));
    await expect(searchAll(testClient().jira, "x", { fields: [], maxIssues: 2 })).resolves.toHaveLength(2);
  });

  it("boş sayfa + token ya da tekrar eden token sonsuz döngüye sokmaz", async () => {
    server.use(http.post(`${JIRA}/rest/api/3/search/jql`, () => HttpResponse.json({ issues: [], nextPageToken: "t", isLast: false })));
    await expect(searchAll(testClient().jira, "x", { fields: [] })).rejects.toBeInstanceOf(JiraSearchLimitError);

    server.use(http.post(`${JIRA}/rest/api/3/search/jql`, () => HttpResponse.json({ issues: [issue(1)], nextPageToken: "ayni" })));
    await expect(searchAll(testClient().jira, "x", { fields: [] })).rejects.toBeInstanceOf(JiraSearchLimitError);
  });

  it("isLast true ise token olsa bile durur", async () => {
    let calls = 0;
    server.use(
      http.post(`${JIRA}/rest/api/3/search/jql`, () => {
        calls++;
        return HttpResponse.json({ issues: [issue(1)], nextPageToken: "t", isLast: true });
      }),
    );
    await searchAll(testClient().jira, "x", { fields: [] });
    expect(calls).toBe(1);
  });
});

describe("getMyPermissions", () => {
  it("istenen her yetki için boolean döndürür; eksik olanı false sayar", async () => {
    let query: URLSearchParams | undefined;
    server.use(
      http.get(`${JIRA}/rest/api/3/mypermissions`, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json({
          permissions: { ADD_COMMENTS: { key: "ADD_COMMENTS", havePermission: true } },
        });
      }),
    );
    const result = await getMyPermissions(testClient().jira, "P", ["ADD_COMMENTS", "ADMINISTER_PROJECTS"]);
    expect(result).toEqual({ ADD_COMMENTS: true, ADMINISTER_PROJECTS: false });
    expect(query?.get("projectKey")).toBe("P");
    expect(query?.get("permissions")).toBe("ADD_COMMENTS,ADMINISTER_PROJECTS");
  });
});

describe("getProjectStatuses", () => {
  it("issue tipleri arasında statüleri tekilleştirir", async () => {
    server.use(
      http.get(`${JIRA}/rest/api/3/project/P/statuses`, () =>
        HttpResponse.json([
          { id: "1", name: "Bug", statuses: [{ id: "10", name: "To be Deployed" }, { id: "11", name: "Completed" }] },
          { id: "2", name: "Story", statuses: [{ id: "11", name: "Completed" }, { id: "12", name: "In Test" }] },
        ]),
      ),
    );
    const statuses = await getProjectStatuses(testClient().jira, "P");
    expect(statuses.map((s) => s.id).sort()).toEqual(["10", "11", "12"]);
  });
});
