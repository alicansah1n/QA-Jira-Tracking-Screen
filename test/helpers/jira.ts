import { vi } from "vitest";
import { createJiraClient } from "@/lib/jira/client";

export const JIRA = "https://test.atlassian.net";

/** Beklemeleri anında tamamlayan, çağrıları kaydeden test istemcisi. */
export function testClient(overrides: Partial<Parameters<typeof createJiraClient>[0]> = {}) {
  const sleep = vi.fn(async (_ms: number) => {});
  const jira = createJiraClient({
    baseUrl: JIRA,
    email: "qa@example.com",
    apiToken: "secret-token",
    sleep,
    random: () => 0.5,
    ...overrides,
  });
  return { jira, sleep };
}
