import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { getProjectSetup, runConnectionCheck } from "@/domain/settings/connection-check";
import { JiraError } from "@/lib/jira/errors";
import { JIRA, testClient } from "../../helpers/jira";
import { server } from "../../helpers/msw";

function jiraHandlers() {
  return [
    http.get(`${JIRA}/rest/api/3/myself`, () => HttpResponse.json({ accountId: "me", displayName: "Ali QA" })),
    http.get(`${JIRA}/rest/api/3/field`, () =>
      HttpResponse.json([
        { id: "customfield_100", name: "Developer", custom: true, schema: { type: "user" } },
        { id: "customfield_101", name: "Test Assignee", custom: true, schema: { type: "user" } },
        { id: "customfield_102", name: "StoryPointTest", custom: true, schema: { type: "number" } },
      ]),
    ),
    http.get(`${JIRA}/rest/api/3/project/:key`, ({ params }) =>
      params.key === "OK"
        ? HttpResponse.json({ id: "1", key: "OK", name: "Ok Projesi" })
        : HttpResponse.json({ errorMessages: ["No project"] }, { status: 404 }),
    ),
    http.get(`${JIRA}/rest/api/3/mypermissions`, () =>
      HttpResponse.json({ permissions: { ADD_COMMENTS: { key: "ADD_COMMENTS", havePermission: true } } }),
    ),
    http.get(`${JIRA}/rest/api/3/project/:key/statuses`, () =>
      HttpResponse.json([
        {
          id: "1",
          name: "Story",
          statuses: [
            { id: "10", name: "To be Deployed" },
            { id: "11", name: "Completed", statusCategory: { key: "done" } },
            { id: "12", name: "In Test", statusCategory: { key: "indeterminate" } },
          ],
        },
      ]),
    ),
  ];
}

describe("runConnectionCheck", () => {
  it("kullanıcıyı ve alan önerilerini döndürür", async () => {
    server.use(...jiraHandlers());
    const check = await runConnectionCheck(testClient().jira);
    expect(check.myself.displayName).toBe("Ali QA");
    expect(check.fields.developer.suggestion?.id).toBe("customfield_100");
    expect(check.fields.testAssignee.suggestion?.id).toBe("customfield_101");
    expect(check.fields.storyPointTest.suggestion?.id).toBe("customfield_102");
  });

  it("kimlik doğrulama hatasını yukarı iletir", async () => {
    server.use(
      http.get(`${JIRA}/rest/api/3/myself`, () => new HttpResponse(null, { status: 401 })),
      http.get(`${JIRA}/rest/api/3/field`, () => new HttpResponse(null, { status: 401 })),
    );
    const error = await runConnectionCheck(testClient().jira).catch((e) => e);
    expect(error).toBeInstanceOf(JiraError);
    expect((error as JiraError).status).toBe(401);
  });
});

describe("getProjectSetup", () => {
  it("statü eşleme önerisi ve yetkileri döndürür", async () => {
    server.use(...jiraHandlers());
    const setup = await getProjectSetup(testClient().jira, "OK");
    expect(setup.name).toBe("Ok Projesi");
    expect(setup.permissions.ADD_COMMENTS).toBe(true);
    expect(setup.permissions.ADMINISTER_PROJECTS).toBe(false);
    expect(setup.suggestion).toEqual({
      name: "Ok Projesi",
      toBeDeployed: { id: "10", name: "To be Deployed" },
      completed: { id: "11", name: "Completed" },
      inTest: [{ id: "12", name: "In Test" }],
    });
  });

  it("erişilemeyen projede JiraError fırlatır", async () => {
    server.use(...jiraHandlers());
    await expect(getProjectSetup(testClient().jira, "YOK")).rejects.toBeInstanceOf(JiraError);
  });
});
