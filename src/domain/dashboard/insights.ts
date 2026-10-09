import type { IssueRow } from "@/domain/issues/row";
import { stageOf, type Stage } from "@/domain/issues/stage";
import type { ReleaseSummary } from "@/domain/releases/service";

/** Panodaki iş kuyruğu ve öneriler. Saf fonksiyonlar: hem tarayıcıda hem testlerde çalışır. */

export type Severity = "critical" | "warning" | "good" | "info";

/** Kuyruktaki sekmeler; "Diğer" geliştirmede ya da analizde olan maddelerdir. */
export type QueueTab = "test" | "new" | "paused" | "progress";

export type Action = {
  id: string;
  severity: Severity;
  count: number;
  title: string;
  /** Ya sayfadaki kuyruğun bir sekmesini açar ya da başka sayfaya gider. */
  target: { tab: QueueTab } | { href: string };
};

type Item = Pick<IssueRow, "key" | "status" | "priority" | "updated" | "statusCategoryChangedAt"> & {
  statusSince?: string;
  devRequest: { eligibility: { eligible: boolean }; ledger?: { state: string } };
};

export type QueueItem<T extends Item = Item> = T & { stage: Stage; days: number };

const DAY = 86_400_000;
/** Bu kadar günden eski gecikmiş release artık "unutulmuş" sayılır, panoda gösterilmez. */
export const OLD_OVERDUE_DAYS = 30;
/** Bu kadar gündür beklemede olan madde gözden geçirilmeli (iptal mi, devam mı?). */
export const OLD_PAUSED_DAYS = 30;

const HIGH_PRIORITY = ["highest", "high", "blocker", "critical", "en yüksek", "yüksek", "kritik"];
export const isHighPriority = (name: string | undefined) => Boolean(name && HIGH_PRIORITY.includes(name.trim().toLocaleLowerCase("tr")));

const daysSince = (iso: string | undefined, now: number) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((now - t) / DAY));
};

/** Maddelere aşama ve "bu statüde kaç gündür" bilgisini ekler; en uzun bekleyen başta. */
export function buildQueue<T extends Item>(items: T[], isTest: (s: { id: string; name: string }) => boolean, now: number): QueueItem<T>[] {
  return items
    .map((i) => ({ ...i, stage: stageOf(i.status, isTest), days: daysSince(i.statusSince ?? i.statusCategoryChangedAt ?? i.updated, now) }))
    .sort((a, b) => b.days - a.days);
}

/** Bekleme süresinin rengi: testte eşik ve iki katı, yeni ve beklemede daha toleranslı. */
export function ageTone(stage: Stage, days: number, staleTestDays: number): "danger" | "warning" | "neutral" {
  if (stage === "test") return days >= staleTestDays * 2 ? "danger" : days >= staleTestDays ? "warning" : "neutral";
  if (stage === "paused") return days >= OLD_PAUSED_DAYS ? "warning" : "neutral";
  return days >= staleTestDays * 2 ? "warning" : "neutral";
}

const ORDER: Record<Severity, number> = { critical: 0, warning: 1, good: 2, info: 3 };

export function buildActions(input: {
  queue: QueueItem[];
  releases?: ReleaseSummary[];
  staleTestDays: number;
  /** Bu hafta kapatılan ama StoryPointTest'i boş madde sayısı. */
  missingEffort?: number;
}): Action[] {
  const { queue, releases = [], staleTestDays, missingEffort = 0 } = input;
  const active = queue.filter((i) => i.stage === "test" || i.stage === "new");
  const all: Action[] = [
    {
      id: "overdue",
      severity: "critical",
      count: releases.filter((r) => r.timing === "overdue" && (r.daysToRelease ?? 0) >= -OLD_OVERDUE_DAYS).length,
      title: "Gecikmiş release",
      target: { href: "/releases" },
    },
    {
      id: "high-priority",
      severity: "critical",
      count: active.filter((i) => isHighPriority(i.priority?.name)).length,
      title: "Yüksek öncelikli, sırada bekleyen",
      target: { tab: "test" },
    },
    {
      id: "stale-test",
      severity: "warning",
      count: queue.filter((i) => i.stage === "test" && i.days >= staleTestDays).length,
      title: `${staleTestDays}+ gündür testte`,
      target: { tab: "test" },
    },
    {
      id: "release-risk",
      severity: "warning",
      count: releases.filter((r) => r.timing === "soon").reduce((n, r) => n + r.counts.inTest, 0),
      title: "Yaklaşan release'te testi bitmemiş",
      target: { href: "/releases" },
    },
    {
      id: "dev-request",
      severity: "warning",
      count: queue.filter((i) => i.devRequest.eligibility.eligible && i.devRequest.ledger?.state !== "sent" && i.devRequest.ledger?.state !== "skipped").length,
      title: "Bilgi talebi gönderilmeli",
      target: { href: "/inbox" },
    },
    { id: "ready", severity: "good", count: releases.filter((r) => r.readyToClose).length, title: "Kapatmaya hazır release", target: { href: "/releases/close" } },
    { id: "missing-effort", severity: "info", count: missingEffort, title: "Bu hafta kapanan, eforu girilmemiş", target: { href: "/reports" } },
    {
      id: "old-paused",
      severity: "info",
      count: queue.filter((i) => i.stage === "paused" && i.days >= OLD_PAUSED_DAYS).length,
      title: `${OLD_PAUSED_DAYS}+ gündür beklemede`,
      target: { tab: "paused" },
    },
  ];
  // Yüksek öncelikli maddenin sekmesi, maddelerin çoğunun bulunduğu aşamaya göre seçilir.
  const hp = all.find((a) => a.id === "high-priority")!;
  const hpNew = active.filter((i) => i.stage === "new" && isHighPriority(i.priority?.name)).length;
  if (hpNew * 2 > hp.count) hp.target = { tab: "new" };
  return all.filter((a) => a.count > 0).sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || b.count - a.count);
}

/** Panoda gösterilecek release'ler: yakın zamanda gecikenler, sonra yaklaşanlar tarih sırasıyla. */
export function relevantReleases<T extends ReleaseSummary>(releases: T[], limit = 5): { shown: T[]; hiddenOld: number } {
  const upcoming = releases
    .filter((r) => r.timing === "soon" || r.timing === "scheduled")
    .sort((a, b) => (a.daysToRelease ?? 0) - (b.daysToRelease ?? 0));
  const overdue = releases
    .filter((r) => r.timing === "overdue" && (r.daysToRelease ?? 0) >= -OLD_OVERDUE_DAYS)
    .sort((a, b) => (b.daysToRelease ?? 0) - (a.daysToRelease ?? 0));
  const undated = releases.filter((r) => r.timing === "no-date");
  return {
    shown: [...overdue, ...upcoming, ...undated].slice(0, limit),
    hiddenOld: releases.filter((r) => r.timing === "overdue" && (r.daysToRelease ?? 0) < -OLD_OVERDUE_DAYS).length,
  };
}
