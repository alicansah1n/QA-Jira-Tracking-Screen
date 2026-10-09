import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { http, HttpResponse } from "msw";
import { buildContext, type Context } from "@/lib/server/context";
import { JIRA, testClient } from "./jira";
import { server } from "./msw";

/**
 * Bellek içi, durum tutan sahte Jira. Release kapatma ve bilgi talebi gibi çok adımlı akışları
 * gerçek istemciyle uçtan uca test etmek için; istenen adımda hata üretebilir.
 */
export type FakeIssue = {
  id: string;
  key: string;
  summary: string;
  statusId: string;
  components?: string[];
  developer?: { accountId: string; displayName: string };
  versionIds?: string[];
};

export type Fault = "error500" | "error400" | "applied500";

export type FakeJira = ReturnType<typeof createFakeJira>;

export const STATUS = {
  inTest: { id: "3", name: "In Test", statusCategory: { key: "indeterminate" } },
  toBeDeployed: { id: "10", name: "To be Deployed", statusCategory: { key: "indeterminate" } },
  completed: { id: "11", name: "Completed", statusCategory: { key: "done" } },
} as const;

export function createFakeJira() {
  const statuses = new Map<string, { id: string; name: string; statusCategory: { key: string } }>(Object.values(STATUS).map((s) => [s.id, { ...s }]));
  const issues = new Map<string, FakeIssue>();
  const comments = new Map<string, { id: string; properties: { key: string; value: unknown }[]; body: unknown }[]>();
  const properties = new Map<string, unknown>();
  const attachments = new Map<string, { id: string; filename: string }[]>();
  let attachmentSeq = 5000;
  const versions = new Map<string, { id: string; name: string; released: boolean; releaseDate?: string; projectId: number }>();
  /** statü id → bu statüden çıkan geçişler */
  const transitions = new Map<string, { id: string; name: string; to: string }[]>([
    [STATUS.inTest.id, [{ id: "31", name: "Test OK", to: STATUS.toBeDeployed.id }]],
    [STATUS.toBeDeployed.id, [{ id: "41", name: "Deploy", to: STATUS.completed.id }]],
    [STATUS.completed.id, [{ id: "51", name: "Reopen deploy", to: STATUS.toBeDeployed.id }]],
  ]);
  const faults: { transition?: (key: string) => Fault | undefined; comment?: (key: string) => Fault | undefined; release?: () => Fault | undefined } = {};
  const permissions: Record<string, boolean> = {
    ADMINISTER_PROJECTS: true,
    TRANSITION_ISSUES: true,
    ADD_COMMENTS: true,
    DELETE_OWN_COMMENTS: true,
  };
  let commentSeq = 1000;
  const calls: string[] = [];

  const status = (id: string) => statuses.get(id)!;
  const issueJson = (i: FakeIssue) => ({
    id: i.id,
    key: i.key,
    fields: {
      summary: i.summary,
      status: status(i.statusId),
      project: { key: i.key.split("-")[0], name: "Demo" },
      components: (i.components ?? []).map((name) => ({ name })),
      comment: { total: comments.get(i.key)?.length ?? 0, comments: [] },
      fixVersions: (i.versionIds ?? []).map((id) => ({ id, name: versions.get(id)?.name })),
      customfield_dev: i.developer ?? null,
      updated: "2026-10-07T10:00:00.000+0300",
      attachment: attachments.get(i.key) ?? [],
    },
  });
  const fail = (f: Fault | undefined, apply: () => void) => {
    if (f === "applied500") {
      apply();
      return new HttpResponse(null, { status: 500 });
    }
    if (f === "error500") return new HttpResponse(null, { status: 500 });
    if (f === "error400") return HttpResponse.json({ errorMessages: ["Validator failed"] }, { status: 400 });
    return undefined;
  };

  const handlers = [
    http.get(`${JIRA}/rest/api/3/myself`, () => HttpResponse.json({ accountId: "me-1", displayName: "QA Kişi" })),
    http.get(`${JIRA}/rest/api/3/project/:id`, ({ params }) => HttpResponse.json({ id: "100", key: "DEMO", name: "Demo Projesi", _q: params.id })),
    http.get(`${JIRA}/rest/api/3/mypermissions`, () =>
      HttpResponse.json({ permissions: Object.fromEntries(Object.entries(permissions).map(([k, v]) => [k, { key: k, havePermission: v }])) }),
    ),
    http.get(`${JIRA}/rest/api/3/version/:id`, ({ params }) => {
      const v = versions.get(String(params.id));
      return v ? HttpResponse.json(v) : new HttpResponse(null, { status: 404 });
    }),
    http.put(`${JIRA}/rest/api/3/version/:id`, async ({ params, request }) => {
      const v = versions.get(String(params.id));
      if (!v) return new HttpResponse(null, { status: 404 });
      const body = (await request.json()) as { released: boolean; releaseDate?: string };
      calls.push(`release:${body.released}`);
      const apply = () => Object.assign(v, { released: body.released, ...(body.releaseDate ? { releaseDate: body.releaseDate } : {}) });
      if (body.released) {
        const r = fail(faults.release?.(), apply);
        if (r) return r;
      }
      apply();
      return HttpResponse.json(v);
    }),
    // Statü geçmişi tutulmaz; çağıranlar `statuscategorychangedate` yedeğine düşer.
    http.post(`${JIRA}/rest/api/3/changelog/bulkfetch`, () => HttpResponse.json({ issueChangeLogs: [] })),
    http.get(`${JIRA}/rest/api/3/status`, () => HttpResponse.json([...statuses.values()])),
    http.post(`${JIRA}/rest/api/3/search/jql`, async ({ request }) => {
      const body = (await request.json()) as { jql: string };
      const m = /fixVersion = (\d+)/.exec(body.jql);
      const key = /key = "([^"]+)"/.exec(body.jql)?.[1];
      const list = [...issues.values()].filter((i) => (m ? i.versionIds?.includes(m[1]!) : key ? i.key === key : true));
      return HttpResponse.json({ issues: list.map(issueJson), isLast: true });
    }),
    http.get(`${JIRA}/rest/api/3/issue/:key/transitions`, ({ params }) => {
      const i = issues.get(String(params.key))!;
      return HttpResponse.json({
        transitions: (transitions.get(i.statusId) ?? []).map((t) => ({ id: t.id, name: t.name, to: status(t.to), fields: {} })),
      });
    }),
    http.post(`${JIRA}/rest/api/3/issue/:key/transitions`, async ({ params, request }) => {
      const key = String(params.key);
      const i = issues.get(key)!;
      const body = (await request.json()) as { transition: { id: string } };
      const t = (transitions.get(i.statusId) ?? []).find((x) => x.id === body.transition.id);
      if (!t) return HttpResponse.json({ errorMessages: ["Transition not valid"] }, { status: 400 });
      calls.push(`transition:${key}:${t.to}`);
      const r = fail(faults.transition?.(key), () => (i.statusId = t.to));
      if (r) return r;
      i.statusId = t.to;
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(`${JIRA}/rest/api/3/issue/:key/comment`, ({ params }) => {
      const list = comments.get(String(params.key)) ?? [];
      return HttpResponse.json({ comments: list.map((c) => ({ id: c.id, properties: c.properties })), startAt: 0, maxResults: 100, total: list.length });
    }),
    http.post(`${JIRA}/rest/api/3/issue/:key/comment`, async ({ params, request }) => {
      const key = String(params.key);
      const body = (await request.json()) as { body: unknown; properties?: { key: string; value: unknown }[] };
      const c = { id: String(commentSeq++), properties: body.properties ?? [], body: body.body };
      calls.push(`comment:${key}`);
      const add = () => comments.set(key, [...(comments.get(key) ?? []), c]);
      const r = fail(faults.comment?.(key), add);
      if (r) return r;
      add();
      return HttpResponse.json({ id: c.id }, { status: 201 });
    }),
    http.delete(`${JIRA}/rest/api/3/issue/:key/comment/:id`, ({ params }) => {
      const key = String(params.key);
      calls.push(`delete-comment:${key}`);
      comments.set(key, (comments.get(key) ?? []).filter((c) => c.id !== String(params.id)));
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(`${JIRA}/rest/api/3/issue/:key/properties/:prop`, ({ params }) => {
      const v = properties.get(`${params.key}/${params.prop}`);
      return v === undefined ? new HttpResponse(null, { status: 404 }) : HttpResponse.json({ key: params.prop, value: v });
    }),
    http.put(`${JIRA}/rest/api/3/issue/:key/properties/:prop`, async ({ params, request }) => {
      properties.set(`${params.key}/${params.prop}`, await request.json());
      return new HttpResponse(null, { status: 200 });
    }),
    http.post(`${JIRA}/rest/api/3/issue/:key/attachments`, async ({ params, request }) => {
      const key = String(params.key);
      if (request.headers.get("x-atlassian-token") !== "no-check") return new HttpResponse(null, { status: 403 });
      const file = (await request.formData()).get("file") as File;
      const att = { id: String(attachmentSeq++), filename: file.name };
      calls.push(`attach:${key}`);
      attachments.set(key, [...(attachments.get(key) ?? []), att]);
      return HttpResponse.json([att]);
    }),
    http.get(`${JIRA}/rest/api/3/issue/:key/editmeta`, () => HttpResponse.json({ fields: {} })),
    http.put(`${JIRA}/rest/api/3/issue/:key`, () => new HttpResponse(null, { status: 204 })),
    http.get(`${JIRA}/rest/api/3/issue/:key`, ({ params }) => {
      const i = issues.get(String(params.key));
      return i ? HttpResponse.json(issueJson(i)) : new HttpResponse(null, { status: 404 });
    }),
  ];

  return {
    statuses,
    issues,
    comments,
    properties,
    versions,
    transitions,
    faults,
    permissions,
    calls,
    attachments,
    install: () => server.use(...handlers),
    addIssue(i: FakeIssue) {
      issues.set(i.key, i);
    },
    addVersion(id: string, name: string, keys: string[]) {
      versions.set(id, { id, name, released: false, releaseDate: "2026-10-10", projectId: 100 });
      for (const k of keys) {
        const i = issues.get(k)!;
        i.versionIds = [...(i.versionIds ?? []), id];
      }
    },
    statusOf: (key: string) => issues.get(key)!.statusId,
    commentCount: (key: string) => comments.get(key)?.length ?? 0,
  };
}

/** Geçici veri klasörü ve sahte Jira ile gerçek bağlam. */
export async function setupFakeContext(): Promise<{ ctx: Context; fake: FakeJira; cleanup: () => Promise<void>; dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "qa-ctx-"));
  const fake = createFakeJira();
  fake.install();
  const { jira } = testClient();
  const ctx = buildContext({ JIRA_BASE_URL: JIRA, JIRA_EMAIL: "qa@example.com", JIRA_API_TOKEN: "t", DATA_DIR: dir }, jira);
  await ctx.settings.update((s) => ({
    ...s,
    fields: { ...s.fields, developer: { id: "customfield_dev", name: "Developer" } },
    projects: {
      DEMO: {
        name: "Demo Projesi",
        toBeDeployed: { id: STATUS.toBeDeployed.id, name: STATUS.toBeDeployed.name },
        completed: { id: STATUS.completed.id, name: STATUS.completed.name },
        inTest: [{ id: STATUS.inTest.id, name: STATUS.inTest.name }],
      },
    },
  }));
  return { ctx, fake, dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
