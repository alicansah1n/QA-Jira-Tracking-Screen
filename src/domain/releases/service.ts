import "server-only";
import type { AnalysisStore } from "@/domain/analysis/store";
import { isStale } from "@/domain/inbox/service";
import { daysBetween, rowFields, toIssueRow, type IssueRow } from "@/domain/issues/row";
import type { Preferences, TrackedProject } from "@/domain/settings/schema";
import { searchAll } from "@/lib/jira/api";
import { getProjectVersions, getVersion, lastStatusChange } from "@/lib/jira/operations";
import type { JiraVersion } from "@/lib/jira/schemas";
import type { Context } from "@/lib/server/context";

export type ReleaseIssue = IssueRow & {
  daysInStatus?: number;
  inTest: boolean;
  staleInTest: boolean;
  readiness: "to-be-deployed" | "completed" | "other";
  analysis: "none" | "ok" | "stale" | "invalid";
};

export type ReleaseTiming = "overdue" | "soon" | "scheduled" | "no-date";

export type ReleaseSummary = {
  id: string;
  name: string;
  description?: string;
  releaseDate?: string;
  startDate?: string;
  timing: ReleaseTiming;
  daysToRelease?: number;
  counts: { total: number; done: number; inProgress: number; todo: number; inTest: number; staleInTest: number; toBeDeployed: number; completed: number; other: number };
  /** Release kapatma kurallarına göre hazır mı (statü eşlemesi varsa). */
  readyToClose: boolean | undefined;
};

export function releaseTiming(releaseDate: string | undefined, today: Date, soonDays: number): { timing: ReleaseTiming; days?: number } {
  if (!releaseDate) return { timing: "no-date" };
  const target = Date.parse(`${releaseDate}T00:00:00`);
  if (Number.isNaN(target)) return { timing: "no-date" };
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const days = Math.round((target - start) / 86_400_000);
  if (days < 0) return { timing: "overdue", days };
  if (days <= soonDays) return { timing: "soon", days };
  return { timing: "scheduled", days };
}

function readiness(row: IssueRow, project: TrackedProject): ReleaseIssue["readiness"] {
  if (project.toBeDeployed && row.status.id === project.toBeDeployed.id) return "to-be-deployed";
  if (project.completed && row.status.id === project.completed.id) return "completed";
  return "other";
}

async function enrich(
  ctx: Context,
  rows: IssueRow[],
  project: TrackedProject,
  prefs: Preferences,
  analyses: AnalysisStore,
  now: Date,
): Promise<ReleaseIssue[]> {
  const inTestIds = new Set(project.inTest.map((s) => s.id));
  const testRows = rows.filter((r) => inTestIds.has(r.status.id));
  const changes = await lastStatusChange(
    ctx.jira,
    testRows.map((r) => ({ id: r.id, statusId: r.status.id, fallback: r.statusCategoryChangedAt })),
  );
  const entries = new Map((await analyses.list()).map((e) => [e.key, e]));
  return rows.map((r) => {
    const inTest = inTestIds.has(r.status.id);
    const days = daysBetween(inTest ? changes.get(r.id) : r.statusCategoryChangedAt, now);
    const entry = entries.get(r.key);
    return {
      ...r,
      daysInStatus: days,
      inTest,
      staleInTest: inTest && days !== undefined && days >= prefs.staleTestDays,
      readiness: readiness(r, project),
      analysis: !entry ? "none" : !entry.ok ? "invalid" : isStale(entry.analysis.issue.updated, r.updated) ? "stale" : "ok",
    };
  });
}

function summarize(version: JiraVersion, issues: ReleaseIssue[], project: TrackedProject, prefs: Preferences, now: Date): ReleaseSummary {
  const { timing, days } = releaseTiming(version.releaseDate, now, prefs.releaseSoonDays);
  const c = { total: issues.length, done: 0, inProgress: 0, todo: 0, inTest: 0, staleInTest: 0, toBeDeployed: 0, completed: 0, other: 0 };
  for (const i of issues) {
    if (i.status.category === "done") c.done++;
    else if (i.status.category === "indeterminate") c.inProgress++;
    else c.todo++;
    if (i.inTest) c.inTest++;
    if (i.staleInTest) c.staleInTest++;
    if (i.readiness === "to-be-deployed") c.toBeDeployed++;
    else if (i.readiness === "completed") c.completed++;
    else c.other++;
  }
  const mapped = Boolean(project.toBeDeployed && project.completed);
  return {
    id: version.id,
    name: version.name,
    description: version.description,
    releaseDate: version.releaseDate,
    startDate: version.startDate,
    timing,
    daysToRelease: days,
    counts: c,
    readyToClose: mapped ? c.total > 0 && c.other === 0 : undefined,
  };
}

export type ProjectReleases = {
  project: { key: string; name: string; mapped: boolean };
  releases: (ReleaseSummary & { issues: ReleaseIssue[] })[];
  /** Herhangi bir release'te testte bekleyen maddeler (en uzun bekleyen önce). */
  waitingInTest: (ReleaseIssue & { versionName: string })[];
};

export async function listProjectReleases(ctx: Context, projectKey: string, analyses: AnalysisStore, now = new Date()): Promise<ProjectReleases> {
  await ctx.myself();
  const settings = await ctx.settings.read();
  const project = settings.projects[projectKey];
  if (!project) throw new Error("Proje takip edilmiyor");
  const custom = { developer: settings.fields.developer?.id, testAssignee: settings.fields.testAssignee?.id };
  const versions = (await getProjectVersions(ctx.jira, projectKey, "unreleased")).filter((v) => !v.archived);
  const issues = versions.length
    ? await searchAll(ctx.jira, `project = "${projectKey}" AND fixVersion in unreleasedVersions("${projectKey}") ORDER BY status`, {
        fields: rowFields(custom),
        maxIssues: 3000,
      })
    : [];
  const rows = await enrich(ctx, issues.map((i) => toIssueRow(i, custom)), project, settings.preferences, analyses, now);

  const releases = versions.map((v) => {
    const own = rows.filter((r) => r.fixVersions.some((f) => f.id === v.id));
    return { ...summarize(v, own, project, settings.preferences, now), issues: own };
  });
  releases.sort((a, b) => (a.releaseDate ?? "9999").localeCompare(b.releaseDate ?? "9999"));
  const versionName = new Map(versions.map((v) => [v.id, v.name]));
  const waitingInTest = rows
    .filter((r) => r.inTest)
    .map((r) => ({ ...r, versionName: r.fixVersions.map((f) => versionName.get(f.id)).filter(Boolean).join(", ") }))
    .sort((a, b) => (b.daysInStatus ?? 0) - (a.daysInStatus ?? 0));

  return {
    project: { key: projectKey, name: project.name, mapped: Boolean(project.toBeDeployed && project.completed) },
    releases,
    waitingInTest,
  };
}

export async function getReleaseDetail(ctx: Context, versionId: string, analyses: AnalysisStore, now = new Date()) {
  await ctx.myself();
  const settings = await ctx.settings.read();
  const version = await getVersion(ctx.jira, versionId);
  const projectKey = await projectKeyOf(ctx, version);
  const project = settings.projects[projectKey] ?? { name: projectKey, inTest: [] };
  const custom = { developer: settings.fields.developer?.id, testAssignee: settings.fields.testAssignee?.id };
  const issues = await searchAll(ctx.jira, `fixVersion = ${Number(version.id)} ORDER BY status`, { fields: rowFields(custom), maxIssues: 3000 });
  const rows = await enrich(ctx, issues.map((i) => toIssueRow(i, custom)), project, settings.preferences, analyses, now);
  return {
    project: { key: projectKey, name: project.name, tracked: Boolean(settings.projects[projectKey]), mapped: Boolean(project.toBeDeployed && project.completed) },
    release: { ...summarize(version, rows, project, settings.preferences, now), released: version.released },
    issues: rows,
  };
}

/** Versiyonun bağlı olduğu projenin anahtarı. */
export async function projectKeyOf(ctx: Context, version: JiraVersion): Promise<string> {
  if (version.projectId === undefined) throw new Error("Versiyonun projesi belirlenemedi");
  const p = (await ctx.jira.get(`/rest/api/3/project/${version.projectId}`)) as { key?: string };
  if (!p.key) throw new Error("Versiyonun projesi belirlenemedi");
  return p.key;
}
