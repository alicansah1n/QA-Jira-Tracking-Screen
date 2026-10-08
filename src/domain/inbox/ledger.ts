import { z } from "zod";

/** Bilgi talebi gönderim defteri: aynı maddeye iki kez yazılmasını engeller. */
export const LedgerEntrySchema = z.object({
  state: z.enum(["sending", "sent", "unknown", "failed", "skipped"]),
  at: z.string(),
  commentId: z.string().optional(),
  error: z.string().optional(),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const LedgerSchema = z.object({ entries: z.record(z.string(), LedgerEntrySchema).default({}) });
export type Ledger = z.infer<typeof LedgerSchema>;

export const LEDGER_VERSION = 1;

/** Bu süreden eski "sending" kaydı yarıda kalmış sayılır (çökme) ve doğrulanarak yeniden denenir. */
export const STALE_SENDING_MS = 2 * 60_000;

export const InboxSeenSchema = z.object({ seen: z.record(z.string(), z.string()).default({}) });
export type InboxSeen = z.infer<typeof InboxSeenSchema>;
