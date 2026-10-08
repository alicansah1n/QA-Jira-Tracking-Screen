import "server-only";
import { getFields, getMyPermissions, getMyself, getProject, getProjectStatuses } from "@/lib/jira/api";
import type { JiraClient } from "@/lib/jira/client";
import type { JiraStatus } from "@/lib/jira/schemas";
import { discoverField, suggestInTestStatuses, suggestStatus, type FieldDiscovery } from "./discovery";
import { FIELD_SPECS, STATUS_SPECS, type FieldKey, type TrackedProject } from "./schema";

export type ConnectionCheck = {
  myself: { accountId: string; displayName: string; emailAddress?: string; avatarUrl?: string };
  fields: Record<FieldKey, FieldDiscovery>;
};

/** Salt okuma: kimlik doğrulama ve alan eşleme önerileri. */
export async function runConnectionCheck(jira: JiraClient): Promise<ConnectionCheck> {
  const [myself, fields] = await Promise.all([getMyself(jira), getFields(jira)]);
  return {
    myself: {
      accountId: myself.accountId,
      displayName: myself.displayName,
      emailAddress: myself.emailAddress,
      avatarUrl: myself.avatarUrls?.["48x48"],
    },
    fields: Object.fromEntries(FIELD_SPECS.map((spec) => [spec.key, discoverField(fields, spec)])) as Record<FieldKey, FieldDiscovery>,
  };
}

export type ProjectSetup = {
  key: string;
  name: string;
  permissions: Record<string, boolean>;
  statuses: JiraStatus[];
  suggestion: TrackedProject;
};

/** Projeyi takibe almak için gereken bilgiler: statüler, eşleme önerisi ve yetkiler. */
export async function getProjectSetup(jira: JiraClient, key: string): Promise<ProjectSetup> {
  const [project, permissions, statuses] = await Promise.all([getProject(jira, key), getMyPermissions(jira, key), getProjectStatuses(jira, key)]);
  return { key: project.key, name: project.name, permissions, statuses, suggestion: suggestProjectStatuses(project.name, statuses) };
}

export function suggestProjectStatuses(name: string, statuses: readonly JiraStatus[]): TrackedProject {
  const out: TrackedProject = { name, inTest: suggestInTestStatuses(statuses) };
  for (const spec of STATUS_SPECS) {
    const ref = suggestStatus(statuses, spec.names);
    if (ref) out[spec.key] = ref;
  }
  return out;
}
