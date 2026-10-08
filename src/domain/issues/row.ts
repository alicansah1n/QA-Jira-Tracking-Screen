import type { SearchIssue } from "@/lib/jira/schemas";

export type UserLite = { accountId: string; displayName: string; avatarUrl?: string };

export type StatusCategory = "new" | "indeterminate" | "done" | "undefined";

/** Listelerde kullanılan sade madde görünümü. */
export type IssueRow = {
  id: string;
  key: string;
  summary: string;
  status: { id: string; name: string; category: StatusCategory };
  issueType?: { name: string; iconUrl?: string };
  priority?: { name: string; iconUrl?: string };
  project: { key: string; name: string };
  assignee?: UserLite;
  developers: UserLite[];
  testAssignees: UserLite[];
  components: string[];
  commentCount: number;
  fixVersions: { id: string; name: string }[];
  created?: string;
  updated?: string;
  statusCategoryChangedAt?: string;
};

export const BASE_ROW_FIELDS = [
  "summary",
  "status",
  "issuetype",
  "priority",
  "project",
  "assignee",
  "components",
  "comment",
  "fixVersions",
  "created",
  "updated",
  "statuscategorychangedate",
] as const;

export function rowFields(custom: { developer?: string; testAssignee?: string }): string[] {
  return [...BASE_ROW_FIELDS, ...[custom.developer, custom.testAssignee].filter((f): f is string => Boolean(f))];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function toUser(v: unknown): UserLite | undefined {
  const o = obj(v);
  const accountId = str(o?.accountId);
  if (!o || !accountId) return undefined;
  const avatars = obj(o.avatarUrls);
  return { accountId, displayName: str(o.displayName) ?? "?", avatarUrl: str(avatars?.["24x24"]) };
}

export function toUsers(v: unknown): UserLite[] {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  return list.map(toUser).filter((u): u is UserLite => u !== undefined);
}

function category(v: unknown): StatusCategory {
  const key = str(obj(v)?.key);
  return key === "new" || key === "indeterminate" || key === "done" ? key : "undefined";
}

export function toIssueRow(issue: SearchIssue, custom: { developer?: string; testAssignee?: string }): IssueRow {
  const f = issue.fields as Obj;
  const status = obj(f.status);
  const type = obj(f.issuetype);
  const priority = obj(f.priority);
  const project = obj(f.project);
  const comment = obj(f.comment);
  return {
    id: issue.id,
    key: issue.key,
    summary: str(f.summary) ?? "",
    status: { id: str(status?.id) ?? "", name: str(status?.name) ?? "?", category: category(status?.statusCategory) },
    issueType: type ? { name: str(type.name) ?? "", iconUrl: str(type.iconUrl) } : undefined,
    priority: priority ? { name: str(priority.name) ?? "", iconUrl: str(priority.iconUrl) } : undefined,
    project: { key: str(project?.key) ?? issue.key.split("-")[0] ?? "", name: str(project?.name) ?? "" },
    assignee: toUser(f.assignee),
    developers: custom.developer ? toUsers(f[custom.developer]) : [],
    testAssignees: custom.testAssignee ? toUsers(f[custom.testAssignee]) : [],
    components: (Array.isArray(f.components) ? f.components : []).map((c) => str(obj(c)?.name) ?? "").filter(Boolean),
    commentCount:
      typeof comment?.total === "number" ? comment.total : Array.isArray(comment?.comments) ? comment.comments.length : 0,
    fixVersions: (Array.isArray(f.fixVersions) ? f.fixVersions : [])
      .map((v) => ({ id: str(obj(v)?.id) ?? "", name: str(obj(v)?.name) ?? "" }))
      .filter((v) => v.id),
    created: str(f.created),
    updated: str(f.updated),
    statusCategoryChangedAt: str(f.statuscategorychangedate),
  };
}

/** İki zaman arasındaki tam gün sayısı. */
export function daysBetween(fromIso: string | undefined, now: Date): number | undefined {
  if (!fromIso) return undefined;
  const ms = Date.parse(fromIso);
  if (Number.isNaN(ms)) return undefined;
  return Math.max(0, Math.floor((now.getTime() - ms) / 86_400_000));
}
