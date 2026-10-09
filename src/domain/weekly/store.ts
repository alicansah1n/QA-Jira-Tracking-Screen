import { z } from "zod";
import "@/lib/zod-locale";
import { WEEK_ID_PATTERN } from "./week";

export const WEEKLY_VERSION = 1;
export const MAX_NOTE_LENGTH = 4000;

const count = z.number().int().nonnegative();

export const WeekTotalsSchema = z.object({
  closed: count,
  effort: z.number().nonnegative(),
  missingEffort: count,
  returned: count,
  paused: count,
  started: count,
  bugs: count,
  received: count,
  moves: count,
});

/**
 * Kaydedilmiş hafta: kullanıcının notu ve kayıt anındaki sayılar. Liste ayrıntıları kaydedilmez; Jira'daki
 * geçmiş (changelog) değişmediği için rapor her açılışta yeniden hesaplanabilir.
 */
export const SavedWeekSchema = z.object({
  note: z.string().max(MAX_NOTE_LENGTH).default(""),
  savedAt: z.string(),
  /** Jira'ya ulaşılamadığı bir anda yalnızca not kaydedildiyse boş kalır. */
  totals: WeekTotalsSchema.optional(),
  /** Son Teams gönderimi. */
  sentAt: z.string().optional(),
  sentTo: z.string().max(120).optional(),
});
export type SavedWeek = z.infer<typeof SavedWeekSchema>;

export const WeeklyStoreSchema = z.object({
  weeks: z.record(z.string().regex(WEEK_ID_PATTERN), SavedWeekSchema).default({}),
});
export type WeeklyStore = z.infer<typeof WeeklyStoreSchema>;
