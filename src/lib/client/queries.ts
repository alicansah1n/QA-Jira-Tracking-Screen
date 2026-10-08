"use client";

import { useQuery } from "@tanstack/react-query";
import type { InboxResult } from "@/domain/inbox/service";
import type { ProjectReleases } from "@/domain/releases/service";
import type { Settings } from "@/domain/settings/schema";
import { api } from "./api";

export type EnvSummary = { ok: true; jiraBaseUrl: string; jiraEmail: string } | { ok: false; issues: { key: string; message: string }[] };
export type PublicTeamsTarget = { id: string; name: string; url: string };
export type ClientSettings = Omit<Settings, "teams"> & { teams: { targets: PublicTeamsTarget[] } };
export type SettingsResponse = { env: EnvSummary; settings: ClientSettings | null };

export const qk = {
  settings: ["settings"] as const,
  me: ["me"] as const,
  inbox: ["inbox"] as const,
  releases: (project: string) => ["releases", project] as const,
  release: (id: string) => ["release", id] as const,
  run: (key: string) => ["run", key] as const,
  journals: ["journals"] as const,
};

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: () => api<SettingsResponse>("/api/settings") });
}

export function useInbox(enabled = true) {
  return useQuery({ queryKey: qk.inbox, queryFn: () => api<InboxResult>("/api/inbox"), enabled, staleTime: 2 * 60_000 });
}

export function useProjectReleases(project: string | undefined) {
  return useQuery({
    queryKey: qk.releases(project ?? ""),
    queryFn: () => api<ProjectReleases>(`/api/releases?project=${encodeURIComponent(project!)}`),
    enabled: Boolean(project),
    staleTime: 2 * 60_000,
  });
}

/** Ortam hazır mı ve en az bir proje takipte mi? Sayfalar boş durum göstermek için kullanır. */
export function setupState(data: SettingsResponse | undefined) {
  const envOk = data?.env.ok === true;
  const s = data?.settings;
  const projects = s ? Object.keys(s.projects) : [];
  return {
    envOk,
    projects,
    fieldsMapped: Boolean(s?.fields.developer && s.fields.testAssignee && s.fields.storyPointTest),
    statusesMapped: projects.length > 0 && projects.every((k) => s?.projects[k]?.toBeDeployed && s.projects[k]?.completed),
    teams: s?.teams.targets.length ?? 0,
  };
}
