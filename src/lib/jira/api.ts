import "server-only";
import type { JiraClient } from "./client";
import {
  FieldListSchema,
  MyselfSchema,
  PermissionsSchema,
  ProjectSchema,
  ProjectStatusesSchema,
  SearchPageSchema,
  type JiraStatus,
  type SearchIssue,
} from "./schemas";

export const REQUIRED_PERMISSIONS = [
  "BROWSE_PROJECTS",
  "TRANSITION_ISSUES",
  "EDIT_ISSUES",
  "ADD_COMMENTS",
  "DELETE_OWN_COMMENTS",
  "CREATE_ATTACHMENTS",
  "ADMINISTER_PROJECTS",
] as const;
export type RequiredPermission = (typeof REQUIRED_PERMISSIONS)[number];

export function getMyself(jira: JiraClient) {
  return jira.get("/rest/api/3/myself", { schema: MyselfSchema });
}

export async function getMyPermissions(
  jira: JiraClient,
  projectKey: string,
  keys: readonly string[] = REQUIRED_PERMISSIONS,
): Promise<Record<string, boolean>> {
  const res = await jira.get("/rest/api/3/mypermissions", {
    query: { projectKey, permissions: keys.join(",") },
    schema: PermissionsSchema,
  });
  return Object.fromEntries(keys.map((k) => [k, res.permissions[k]?.havePermission ?? false]));
}

export function getFields(jira: JiraClient) {
  return jira.get("/rest/api/3/field", { schema: FieldListSchema });
}

export function getProject(jira: JiraClient, projectKey: string) {
  return jira.get(`/rest/api/3/project/${encodeURIComponent(projectKey)}`, { schema: ProjectSchema });
}

/** Projedeki tüm issue tiplerinde geçen statüler (id'ye göre tekilleştirilmiş). */
export async function getProjectStatuses(jira: JiraClient, projectKey: string): Promise<JiraStatus[]> {
  const byType = await jira.get(`/rest/api/3/project/${encodeURIComponent(projectKey)}/statuses`, {
    schema: ProjectStatusesSchema,
  });
  const unique = new Map<string, JiraStatus>();
  for (const type of byType) for (const status of type.statuses) unique.set(status.id, status);
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

export type SearchOptions = {
  fields: readonly string[];
  pageSize?: number;
  /** Az önce yazılan maddelerin aramada güncel görünmesini sağlar (Jira araması nihai tutarlı). */
  reconcileIssues?: readonly number[];
  /** Güvenlik sınırı. Aşılırsa eksik liste dönmek yerine `JiraSearchLimitError` fırlatılır. */
  maxIssues?: number;
};

/** Arama sonucu sınırı aştı ya da Jira tutarsız sayfa döndürdü; sonuç eksik olabilir. */
export class JiraSearchLimitError extends Error {
  // Next aynı modülü farklı paketlerde (sayfa / route) ayrı kopyalar olarak yükleyebilir; o zaman
  // `instanceof` kopyalar arasında tutmaz. Kontrol sınıf adına göre yapılır.
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null && (value as { name?: unknown }).name === "JiraSearchLimitError";
  }

  constructor(
    readonly jql: string,
    reason: string,
  ) {
    super(`Jira araması tamamlanamadı: ${reason}`);
    this.name = "JiraSearchLimitError";
  }
}

/** POST /rest/api/3/search/jql — nextPageToken ile tüm sayfaları dolaşır. */
export async function* searchJql(jira: JiraClient, jql: string, opts: SearchOptions): AsyncGenerator<SearchIssue> {
  const maxIssues = opts.maxIssues ?? 5000;
  const seenTokens = new Set<string>();
  let nextPageToken: string | undefined;
  let yielded = 0;
  do {
    const page = await jira.post("/rest/api/3/search/jql", {
      json: {
        jql,
        fields: opts.fields,
        maxResults: opts.pageSize ?? 100,
        nextPageToken,
        reconcileIssues: opts.reconcileIssues,
      },
      schema: SearchPageSchema,
      idempotent: true,
    });
    for (const issue of page.issues) {
      if (yielded >= maxIssues) throw new JiraSearchLimitError(jql, `${maxIssues} madde sınırı aşıldı`);
      yielded++;
      yield issue;
    }
    nextPageToken = page.isLast ? undefined : (page.nextPageToken ?? undefined);
    if (nextPageToken !== undefined) {
      // Boş sayfa ya da tekrar eden token ilerleme olmadığını gösterir; sonsuz döngüye girilmez.
      if (page.issues.length === 0 || seenTokens.has(nextPageToken)) {
        throw new JiraSearchLimitError(jql, "Jira sayfalaması ilerlemiyor");
      }
      seenTokens.add(nextPageToken);
    }
  } while (nextPageToken);
}

export async function searchAll(jira: JiraClient, jql: string, opts: SearchOptions): Promise<SearchIssue[]> {
  const out: SearchIssue[] = [];
  for await (const issue of searchJql(jira, jql, opts)) out.push(issue);
  return out;
}
