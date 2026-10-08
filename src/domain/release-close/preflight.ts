import "server-only";
import { createHash } from "node:crypto";
import { projectKeyOf } from "@/domain/releases/service";
import type { StatusRef } from "@/domain/settings/schema";
import { getMyPermissions, searchAll } from "@/lib/jira/api";
import { getTransitions, getVersion } from "@/lib/jira/operations";
import type { Context } from "@/lib/server/context";

export type PlannedIssue = {
  key: string;
  id: string;
  summary: string;
  status: { id: string; name: string };
  action: "transition" | "none" | "blocked";
  transitionId?: string;
  problem?: string;
};

export type ReleasePlan = {
  version: { id: string; name: string; releaseDate?: string; released: boolean };
  project: { key: string; name: string };
  statuses?: { toBeDeployed: StatusRef; completed: StatusRef };
  /** Release'e yazılacak canlı çıkış tarihi (bugün). */
  releaseDate: string;
  issues: PlannedIssue[];
  blockers: string[];
  warnings: string[];
  scenario: "mixed" | "all-to-be-deployed" | "all-completed" | "blocked";
  fingerprint: string;
  canExecute: boolean;
};

/** Önizleme ile onay arasında Jira'da bir şey değiştiyse farklı bir değer üretir. */
export function fingerprintOf(
  version: { id: string; released: boolean; releaseDate?: string },
  issues: readonly { key: string; status: { id: string } }[],
): string {
  const payload = {
    v: [version.id, version.released, version.releaseDate ?? null],
    i: [...issues].map((i) => [i.key, i.status.id]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function todayLocal(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export async function buildReleasePlan(ctx: Context, versionId: string, now = new Date()): Promise<ReleasePlan> {
  await ctx.myself();
  const settings = await ctx.settings.read();
  const version = await getVersion(ctx.jira, versionId);
  const projectKey = await projectKeyOf(ctx, version);
  const project = settings.projects[projectKey];
  const blockers: string[] = [];
  const warnings: string[] = [];

  const raw = await searchAll(ctx.jira, `fixVersion = ${Number(version.id)} ORDER BY key`, { fields: ["summary", "status"], maxIssues: 2000 });
  const issues: PlannedIssue[] = raw.map((i) => {
    const f = i.fields as { summary?: string; status?: { id?: string; name?: string } };
    return {
      key: i.key,
      id: i.id,
      summary: f.summary ?? "",
      status: { id: f.status?.id ?? "", name: f.status?.name ?? "?" },
      action: "none",
    };
  });

  const base = {
    version: { id: version.id, name: version.name, releaseDate: version.releaseDate, released: version.released },
    project: { key: projectKey, name: project?.name ?? projectKey },
    releaseDate: todayLocal(now),
    issues,
    fingerprint: fingerprintOf(version, issues),
  };

  if (version.released) blockers.push("Bu release zaten kapatılmış (released).");
  if (!project?.toBeDeployed || !project.completed) {
    blockers.push(`${projectKey} projesi için "To be Deployed" ve "Completed" statü eşlemesi yapılmamış (Ayarlar).`);
    return { ...base, blockers, warnings, scenario: "blocked", canExecute: false };
  }
  const statuses = { toBeDeployed: project.toBeDeployed, completed: project.completed };
  if (issues.length === 0) blockers.push("Pakette hiç madde yok.");

  // Kural: yalnızca To be Deployed ve Completed kabul edilir; tek bir farklı madde bile işlemi durdurur.
  for (const issue of issues) {
    if (issue.status.id === statuses.toBeDeployed.id) issue.action = "transition";
    else if (issue.status.id === statuses.completed.id) issue.action = "none";
    else {
      issue.action = "blocked";
      issue.problem = `Beklenmeyen statü: ${issue.status.name}`;
    }
  }
  const unexpected = issues.filter((i) => i.action === "blocked");
  if (unexpected.length) blockers.push(`${unexpected.length} madde "To be Deployed" ya da "Completed" dışında bir statüde.`);

  const toTransition = issues.filter((i) => i.action === "transition");

  const permissions = await getMyPermissions(ctx.jira, projectKey, [
    "ADMINISTER_PROJECTS",
    "TRANSITION_ISSUES",
    "ADD_COMMENTS",
    "DELETE_OWN_COMMENTS",
  ]);
  if (!permissions.ADMINISTER_PROJECTS) blockers.push("Release'i kapatmak için proje yönetimi (versiyon) yetkiniz yok.");
  if (toTransition.length) {
    if (!permissions.TRANSITION_ISSUES) blockers.push("Madde statüsü değiştirme yetkiniz yok.");
    if (!permissions.ADD_COMMENTS) blockers.push("Yorum ekleme yetkiniz yok.");
    if (!permissions.DELETE_OWN_COMMENTS) blockers.push("Kendi yorumunu silme yetkiniz yok; hata durumunda geri alma yapılamaz.");
  }

  // Her To be Deployed maddenin Completed'a geçişi olmalı ve zorunlu alan istememeli.
  if (unexpected.length === 0) {
    await Promise.all(
      toTransition.map(async (issue) => {
        const transitions = await getTransitions(ctx.jira, issue.key);
        const t = transitions.find((x) => x.to.id === statuses.completed.id);
        if (!t) {
          issue.action = "blocked";
          issue.problem = `"${statuses.completed.name}" statüsüne geçiş yok`;
          return;
        }
        const required = Object.entries(t.fields ?? {}).filter(([, m]) => m.required && !m.hasDefaultValue);
        if (required.length) {
          issue.action = "blocked";
          issue.problem = `Geçiş zorunlu alan istiyor: ${required.map(([id, m]) => m.name ?? id).join(", ")}`;
          return;
        }
        issue.transitionId = t.id;
      }),
    );
    const noTransition = toTransition.filter((i) => i.action === "blocked");
    if (noTransition.length) blockers.push(`${noTransition.length} madde ${statuses.completed.name} statüsüne geçirilemiyor.`);
  }

  if (toTransition.length) {
    warnings.push(
      `Bir adım başarısız olursa yapılanlar geri alınır (${statuses.completed.name} → ${statuses.toBeDeployed.name}). Workflow bu geri geçişe izin vermiyorsa geri alma manuel tamamlanmalıdır.`,
    );
  }

  const scenario: ReleasePlan["scenario"] = blockers.length
    ? "blocked"
    : toTransition.length === issues.length
      ? "all-to-be-deployed"
      : toTransition.length === 0
        ? "all-completed"
        : "mixed";

  return { ...base, statuses, blockers, warnings, scenario, canExecute: blockers.length === 0 };
}
