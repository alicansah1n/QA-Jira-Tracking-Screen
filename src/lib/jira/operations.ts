import "server-only";
import { z } from "zod";
import type { AdfNode } from "./adf/to-markdown";
import type { JiraClient } from "./client";
import { JiraSearchLimitError } from "./api";
import { JiraError } from "./errors";
import {
  ChangelogBulkSchema,
  CommentPageSchema,
  CommentSchema,
  EditMetaSchema,
  ProjectSearchPageSchema,
  TransitionsSchema,
  VersionPageSchema,
  VersionSchema,
  type JiraVersion,
} from "./schemas";

const enc = encodeURIComponent;

// ── Projeler ──────────────────────────────────────────────────────────────────

export type ProjectSummary = { id: string; key: string; name: string; teamManaged: boolean; avatarUrl?: string };

/** Kullanıcının görebildiği tüm projeler (sayfalı). */
export async function searchProjects(jira: JiraClient, maxProjects = 1000): Promise<ProjectSummary[]> {
  const out: ProjectSummary[] = [];
  for (let startAt = 0; out.length < maxProjects; ) {
    const page = await jira.get("/rest/api/3/project/search", {
      query: { startAt, maxResults: 100, orderBy: "name" },
      schema: ProjectSearchPageSchema,
    });
    for (const p of page.values) {
      out.push({ id: p.id, key: p.key, name: p.name, teamManaged: p.simplified ?? false, avatarUrl: p.avatarUrls?.["24x24"] });
    }
    if (page.isLast !== false || page.values.length === 0) break;
    startAt += page.values.length;
  }
  return out;
}

// ── Geçişler ve düzenleme ─────────────────────────────────────────────────────

export function getTransitions(jira: JiraClient, key: string) {
  return jira
    .get(`/rest/api/3/issue/${enc(key)}/transitions`, { query: { expand: "transitions.fields" }, schema: TransitionsSchema })
    .then((r) => r.transitions);
}

export function transitionIssue(jira: JiraClient, key: string, transitionId: string, fields?: Record<string, unknown>) {
  return jira.post(`/rest/api/3/issue/${enc(key)}/transitions`, {
    json: { transition: { id: transitionId }, ...(fields && Object.keys(fields).length ? { fields } : {}) },
  });
}

export function getEditMeta(jira: JiraClient, key: string) {
  return jira.get(`/rest/api/3/issue/${enc(key)}/editmeta`, { schema: EditMetaSchema }).then((r) => r.fields);
}

export function updateIssueFields(jira: JiraClient, key: string, fields: Record<string, unknown>) {
  return jira.put(`/rest/api/3/issue/${enc(key)}`, { json: { fields }, query: { notifyUsers: "true" } });
}

const StatusOnlySchema = z.looseObject({
  id: z.string(),
  key: z.string(),
  fields: z.looseObject({ status: z.looseObject({ id: z.string(), name: z.string() }), updated: z.string().optional() }),
});

export function getIssueStatus(jira: JiraClient, key: string) {
  return jira
    .get(`/rest/api/3/issue/${enc(key)}`, { query: { fields: "status,updated" }, schema: StatusOnlySchema })
    .then((r) => ({ id: r.fields.status.id, name: r.fields.status.name, updated: r.fields.updated }));
}

// ── Yorumlar ve issue property'leri ──────────────────────────────────────────

export type CommentProperty = { key: string; value: unknown };

/** ADF gövdeli yorum ekler. `properties` görünmez işarettir (idempotency/geri alma için). */
export function addComment(jira: JiraClient, key: string, body: AdfNode, properties?: CommentProperty[]) {
  return jira.post(`/rest/api/3/issue/${enc(key)}/comment`, {
    json: { body, ...(properties?.length ? { properties } : {}) },
    schema: CommentSchema,
  });
}

export function deleteComment(jira: JiraClient, key: string, commentId: string) {
  return jira.delete(`/rest/api/3/issue/${enc(key)}/comment/${enc(commentId)}`);
}

/** Verilen property anahtarını taşıyan yorumları bulur (sonucu bilinmeyen yazmaların doğrulaması). */
export async function findCommentsWithProperty(
  jira: JiraClient,
  key: string,
  propertyKey: string,
  match: (value: unknown) => boolean = () => true,
): Promise<string[]> {
  const ids: string[] = [];
  for (let startAt = 0; ; ) {
    const page = await jira.get(`/rest/api/3/issue/${enc(key)}/comment`, {
      query: { startAt, maxResults: 100, expand: "properties", orderBy: "-created" },
      schema: CommentPageSchema,
    });
    for (const c of page.comments) {
      if (c.properties?.some((p) => p.key === propertyKey && match(p.value))) ids.push(c.id);
    }
    startAt += page.comments.length;
    if (page.comments.length === 0 || startAt >= (page.total ?? 0)) break;
  }
  return ids;
}

export async function getIssueProperty<T = unknown>(jira: JiraClient, key: string, propertyKey: string): Promise<T | undefined> {
  try {
    const res = (await jira.get(`/rest/api/3/issue/${enc(key)}/properties/${enc(propertyKey)}`)) as { value?: T };
    return res.value;
  } catch (error) {
    if (error instanceof JiraError && error.status === 404) return undefined;
    throw error;
  }
}

export function setIssueProperty(jira: JiraClient, key: string, propertyKey: string, value: unknown) {
  return jira.put(`/rest/api/3/issue/${enc(key)}/properties/${enc(propertyKey)}`, { json: value });
}

// ── Ekler ─────────────────────────────────────────────────────────────────────

const AttachmentListSchema = z.array(z.looseObject({ id: z.string(), filename: z.string() }));

export async function addAttachment(jira: JiraClient, key: string, filename: string, content: string, mimeType: string) {
  const form = new FormData();
  form.append("file", new Blob([content], { type: mimeType }), filename);
  const res = await jira.post(`/rest/api/3/issue/${enc(key)}/attachments`, {
    body: form,
    headers: { "X-Atlassian-Token": "no-check" },
    schema: AttachmentListSchema,
  });
  return res[0];
}

const AttachmentFieldSchema = z.looseObject({
  fields: z.looseObject({ attachment: z.array(z.looseObject({ id: z.string(), filename: z.string() })).default([]) }),
});

export function listAttachments(jira: JiraClient, key: string) {
  return jira
    .get(`/rest/api/3/issue/${enc(key)}`, { query: { fields: "attachment" }, schema: AttachmentFieldSchema })
    .then((r) => r.fields.attachment);
}

// ── Versiyonlar (release) ─────────────────────────────────────────────────────

export async function getProjectVersions(
  jira: JiraClient,
  projectKey: string,
  status?: "released" | "unreleased",
): Promise<JiraVersion[]> {
  const out: JiraVersion[] = [];
  for (let startAt = 0; ; ) {
    const page = await jira.get(`/rest/api/3/project/${enc(projectKey)}/version`, {
      query: { startAt, maxResults: 100, orderBy: "releaseDate", status },
      schema: VersionPageSchema,
    });
    out.push(...page.values);
    if (page.isLast !== false || page.values.length === 0) break;
    startAt += page.values.length;
  }
  return out;
}

export function getVersion(jira: JiraClient, versionId: string) {
  return jira.get(`/rest/api/3/version/${enc(versionId)}`, { schema: VersionSchema });
}

export function setVersionReleased(jira: JiraClient, versionId: string, released: boolean, releaseDate?: string) {
  return jira.put(`/rest/api/3/version/${enc(versionId)}`, {
    json: { released, ...(releaseDate ? { releaseDate } : {}) },
    schema: VersionSchema,
  });
}

// ── Statü geçmişi ─────────────────────────────────────────────────────────────

const MAX_HISTORY_PAGES = 200;

export type HistoryChange = { issueId: string; at: number; authorId?: string; field: string; from?: string; to?: string };

/** Maddelerin verilen alanlardaki tüm değişiklikleri (toplu changelog API'si). */
export async function issueHistories(jira: JiraClient, issueIds: readonly string[], fieldIds: readonly string[]): Promise<HistoryChange[]> {
  const out: HistoryChange[] = [];
  for (let i = 0; i < issueIds.length; i += 1000) {
    const chunk = issueIds.slice(i, i + 1000);
    const seen = new Set<string>();
    let nextPageToken: string | undefined;
    let pages = 0;
    do {
      // İlerleyen ama bitmeyen bir sayfalama sonsuz döngüye ve bellek şişmesine yol açmasın.
      if (++pages > MAX_HISTORY_PAGES) throw new JiraSearchLimitError("changelog", "changelog sayfa sınırı aşıldı");
      const page = await jira.post("/rest/api/3/changelog/bulkfetch", {
        json: { issueIdsOrKeys: chunk, fieldIds, maxResults: 1000, nextPageToken },
        schema: ChangelogBulkSchema,
        idempotent: true,
      });
      for (const log of page.issueChangeLogs) {
        for (const h of log.changeHistories) {
          const at = typeof h.created === "number" ? h.created : Date.parse(h.created);
          if (Number.isNaN(at)) continue;
          for (const it of h.items) {
            const field = it.fieldId ?? it.field;
            if (!field || !fieldIds.includes(field)) continue;
            out.push({ issueId: log.issueId, at, authorId: h.author?.accountId, field, from: it.from ?? undefined, to: it.to ?? undefined });
          }
        }
      }
      nextPageToken = page.nextPageToken ?? undefined;
      if (nextPageToken && seen.has(nextPageToken)) throw new JiraSearchLimitError("changelog", "Jira sayfalaması ilerlemiyor");
      if (nextPageToken) seen.add(nextPageToken);
    } while (nextPageToken);
  }
  return out;
}

/**
 * Her madde için "şu anki statüye en son ne zaman girildi" bilgisini döndürür.
 * Önce toplu changelog API'si denenir; desteklenmiyorsa `statuscategorychangedate` alanı kullanılır.
 */
export async function lastStatusChange(
  jira: JiraClient,
  issues: readonly { id: string; statusId: string; fallback?: string }[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (issues.length === 0) return result;
  const wanted = new Map(issues.map((i) => [i.id, i.statusId]));
  try {
    for (let i = 0; i < issues.length; i += 1000) {
      const chunk = issues.slice(i, i + 1000).map((x) => x.id);
      let nextPageToken: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await jira.post("/rest/api/3/changelog/bulkfetch", {
          json: { issueIdsOrKeys: chunk, fieldIds: ["status"], maxResults: 1000, nextPageToken },
          schema: ChangelogBulkSchema,
          idempotent: true,
        });
        for (const log of page.issueChangeLogs) {
          for (const h of log.changeHistories) {
            const to = h.items.find((it) => (it.fieldId ?? it.field) === "status")?.to;
            if (!to || to !== wanted.get(log.issueId)) continue;
            const at = typeof h.created === "number" ? new Date(h.created).toISOString() : h.created;
            const prev = result.get(log.issueId);
            if (!prev || Date.parse(at) > Date.parse(prev)) result.set(log.issueId, at);
          }
        }
        nextPageToken = page.nextPageToken ?? undefined;
        if (nextPageToken && seen.has(nextPageToken)) break;
        if (nextPageToken) seen.add(nextPageToken);
      } while (nextPageToken);
    }
  } catch (error) {
    if (!(error instanceof JiraError) || (error.status !== 404 && error.status !== 405 && error.status !== 400)) throw error;
  }
  for (const i of issues) if (!result.has(i.id) && i.fallback) result.set(i.id, i.fallback);
  return result;
}
