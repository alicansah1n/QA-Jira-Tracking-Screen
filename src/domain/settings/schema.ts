import { z } from "zod";
import "@/lib/zod-locale";

export const FieldRefSchema = z.object({ id: z.string().min(1), name: z.string() });
export type FieldRef = z.infer<typeof FieldRefSchema>;

export const StatusRefSchema = z.object({ id: z.string().min(1), name: z.string() });
export type StatusRef = z.infer<typeof StatusRefSchema>;

export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]+$/;

/**
 * Takip edilen proje ve statü eşlemesi. Team-managed projelerde her projenin kendi
 * "Completed" statüsü ayrı bir id taşır; bu yüzden eşleme proje başına tutulur.
 */
export const TrackedProjectSchema = z.object({
  name: z.string(),
  toBeDeployed: StatusRefSchema.optional(),
  completed: StatusRefSchema.optional(),
  /** "Testte" sayılan statüler (bekleme uyarıları için). */
  inTest: z.array(StatusRefSchema).default([]),
});
export type TrackedProject = z.infer<typeof TrackedProjectSchema>;

/** Teams Workflows ("Post to a channel when a webhook request is received") hedefi. */
export const TeamsTargetSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{6,40}$/),
  name: z.string().trim().min(1).max(80),
  url: z.url({ protocol: /^https$/ }),
});
export type TeamsTarget = z.infer<typeof TeamsTargetSchema>;

export const PreferencesSchema = z.object({
  /** Bu kadar günden uzun testte bekleyen madde uyarı alır. */
  staleTestDays: z.number().int().min(1).max(90).default(5),
  /** Bu kadar gün içinde çıkacak release "yaklaşıyor" sayılır. */
  releaseSoonDays: z.number().int().min(1).max(60).default(7),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

/** Uygulamanın Jira'daki alan ve statüleri tanıdığı eşleme. İsimler değil id'ler esas alınır. */
export const SettingsSchema = z.object({
  fields: z
    .object({
      developer: FieldRefSchema.optional(),
      testAssignee: FieldRefSchema.optional(),
      storyPointTest: FieldRefSchema.optional(),
    })
    .default({}),
  projects: z.record(z.string().regex(PROJECT_KEY_PATTERN), TrackedProjectSchema).default({}),
  teams: z.object({ targets: z.array(TeamsTargetSchema).max(20).default([]) }).default({ targets: [] }),
  preferences: PreferencesSchema.default({ staleTestDays: 5, releaseSoonDays: 7 }),
  updatedAt: z.string().optional(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SETTINGS_VERSION = 1;

export const defaultSettings = (): Settings => SettingsSchema.parse({});

export type FieldKey = keyof Settings["fields"];

export type FieldSpec = {
  key: FieldKey;
  label: string;
  /** Jira'daki olası adları (büyük/küçük harf duyarsız karşılaştırılır). */
  names: string[];
  /** Kabul edilen `schema.type` değerleri. */
  types: string[];
  description: string;
};

export const FIELD_SPECS: readonly FieldSpec[] = [
  {
    key: "developer",
    label: "Developer",
    names: ["Developer", "Geliştirici"],
    types: ["user", "array"],
    description: "Bilgi talebi yorumunda etiketlenecek geliştirici",
  },
  {
    key: "testAssignee",
    label: "Test Assignee",
    names: ["Test Assignee", "Tester", "Testçi"],
    types: ["user", "array"],
    description: "Madde kapanırken doldurulan testçi alanı",
  },
  {
    key: "storyPointTest",
    label: "StoryPointTest",
    names: ["StoryPointTest", "Story Point Test", "Test Story Points"],
    types: ["number"],
    description: "Madde kapanırken doldurulan test story point alanı",
  },
];

export type StatusKey = "toBeDeployed" | "completed";

export const STATUS_SPECS: readonly { key: StatusKey; label: string; names: string[]; description: string }[] = [
  {
    key: "toBeDeployed",
    label: "To be Deployed",
    names: ["To be Deployed", "To Be Deployed"],
    description: "Canlıya çıkmayı bekleyen maddeler",
  },
  {
    key: "completed",
    label: "Completed",
    names: ["Completed"],
    description: "Release kapatılırken maddelerin taşınacağı statü",
  },
];

/** Webhook adresinin yalnızca ana makinesini gösterir; imzalı sorgu kısmı sırdır. */
export function maskWebhookUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}/…${u.pathname.slice(-6)}`;
  } catch {
    return "geçersiz adres";
  }
}
