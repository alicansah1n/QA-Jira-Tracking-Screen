import { z } from "zod";
import { TeamsTargetKindSchema } from "@/domain/settings/schema";

/**
 * Release kapatma günlüğü. Her Jira yazmasından önce adım `pending`, sonra `done` olarak diske yazılır;
 * böylece süreç yarıda kesilse bile neyin yapıldığı bilinir ve geri alınabilir.
 */
export const StepStateSchema = z.enum(["pending", "done", "unknown", "failed", "rolled_back", "rollback_failed", "skipped"]);
export type StepState = z.infer<typeof StepStateSchema>;

export const JournalStepSchema = z.object({
  kind: z.enum(["transition", "comment", "release"]),
  issueKey: z.string().optional(),
  state: StepStateSchema,
  commentId: z.string().optional(),
  error: z.string().optional(),
  at: z.string(),
});
export type JournalStep = z.infer<typeof JournalStepSchema>;

export const NotificationSchema = z.object({
  targetId: z.string(),
  targetName: z.string(),
  // Tür eklenmeden önceki kayıtlarda yok.
  targetKind: TeamsTargetKindSchema.optional(),
  /** Kişiler hedefinde kartın iletildiği kişilerin adları. */
  recipients: z.array(z.string()).optional(),
  at: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
});

export const JournalSchema = z.object({
  runId: z.string().regex(/^[a-z0-9-]{8,64}$/),
  versionId: z.string(),
  versionName: z.string(),
  projectKey: z.string(),
  releaseDate: z.string(),
  /** Kapatmadan önceki versiyon durumu; geri almada planlanan tarih buna döndürülür. */
  originalVersion: z.object({ released: z.boolean(), releaseDate: z.string().optional() }).optional(),
  toBeDeployed: z.object({ id: z.string(), name: z.string() }),
  completed: z.object({ id: z.string(), name: z.string() }),
  issues: z.array(z.object({ key: z.string(), summary: z.string(), action: z.enum(["transition", "none"]) })),
  state: z.enum(["running", "committed", "rolling_back", "rolled_back", "rollback_failed"]),
  steps: z.array(JournalStepSchema).default([]),
  notifications: z.array(NotificationSchema).default([]),
  error: z.string().optional(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  /** Geri alması eksik kalan kayıt, kullanıcı Jira'yı elle düzelttiğini onaylayınca kapanır. */
  acknowledgedAt: z.string().optional(),
});
export type Journal = z.infer<typeof JournalSchema>;

export const JOURNAL_VERSION = 1;

export const JOURNAL_STATE_LABELS: Record<Journal["state"], string> = {
  running: "Yarıda kaldı",
  committed: "Tamamlandı",
  rolling_back: "Geri alınıyor",
  rolled_back: "Geri alındı",
  rollback_failed: "Geri alma eksik — manuel kontrol gerekli",
};
