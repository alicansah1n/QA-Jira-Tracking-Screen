import type { StatusCategory } from "./row";

/**
 * Bir maddenin QA açısından bulunduğu aşama. Jira'daki statü adları projeye göre değişir; "testte" statüleri
 * Ayarlar'daki eşlemeden gelir, beklemede ve iptal statüleri ada göre tanınır.
 */
export type Stage = "test" | "new" | "paused" | "progress" | "done";

const PAUSED = /paus|beklemede|on hold|askıda|durduruldu/i;
const CANCELED = /cancel|iptal|reject|won'?t do/i;
const TEST_NAME = /^(in )?test(ing)?$|^testte$|^test ediliyor$/i;

export const isPausedStatus = (name: string) => PAUSED.test(name);
export const isCanceledStatus = (name: string) => CANCELED.test(name);

type StatusLike = { id: string; name: string };

/** Ayarlarda "testte" statüsü seçilmişse onlar, seçilmemişse "Test" / "In Test" gibi adlar testte sayılır. */
export function testStatusMatcher(ids: Iterable<string>): (s: StatusLike) => boolean {
  const set = new Set(ids);
  return set.size ? (s) => set.has(s.id) : (s) => TEST_NAME.test(s.name.trim());
}

export function stageOf(status: StatusLike & { category: StatusCategory | string }, isTest: (s: StatusLike) => boolean): Stage {
  if (status.category === "done") return "done";
  if (isTest(status)) return "test";
  if (isPausedStatus(status.name)) return "paused";
  if (status.category === "new") return "new";
  return "progress";
}
