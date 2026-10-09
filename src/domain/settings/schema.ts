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

/**
 * Teams Workflows hedefinin türü. Kanal ve sohbet hazır şablonla kurulan sabit hedeflerdir; "Kişiler" ise
 * gönderilen `recipients` listesindeki herkese Workflows botuyla tek tek ileten genel bir akıştır.
 */
export const TEAMS_TARGET_KINDS = { channel: "Kanal", chat: "Sohbet", people: "Kişiler" } as const;
export const TeamsTargetKindSchema = z.enum(["channel", "chat", "people"]);
export type TeamsTargetKind = z.infer<typeof TeamsTargetKindSchema>;

export const TEAMS_ID_PATTERN = /^[a-z0-9-]{6,40}$/;
export const MAX_TEAMS_TARGETS = 20;
export const MAX_TEAMS_CONTACTS = 200;

// Kontrol, sıfır genişlikli ve yön değiştiren karakterler bir adı başka biri gibi gösterebilir.
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/;
export const DisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((n) => !UNSAFE_NAME_CHARS.test(n), "Adda görünmez ya da yön değiştiren karakter olamaz");

/** Teams Workflows webhook hedefi. */
export const TeamsTargetSchema = z.object({
  id: z.string().regex(TEAMS_ID_PATTERN),
  name: DisplayNameSchema,
  // Tür eklenmeden önce kaydedilen hedefler kanal webhook'uydu.
  kind: TeamsTargetKindSchema.default("channel"),
  url: z.url({ protocol: /^https$/ }),
  /**
   * Yalnızca Kişiler hedefinde: her istekte `x-qa-key` başlığıyla gönderilir; akış bunu doğrular. Adres
   * sızsa bile anahtarı bilmeyen kimse akış üzerinden kişilere mesaj attıramaz.
   */
  flowKey: z.string().regex(/^[0-9a-f]{32}$/).optional(),
});
export type TeamsTarget = z.infer<typeof TeamsTargetSchema>;

/** Bir gönderimde en fazla bu kadar kişi seçilebilir (akıştaki koşulla aynı sayı). */
export const MAX_TEAMS_RECIPIENTS = 50;
/** Deneme kartı en fazla bu kadar kişiye gider. */
export const MAX_TEAMS_TEST_RECIPIENTS = 3;

/** İstemcinin bir gönderim için seçtiği kişi kimlikleri. */
export const TeamsContactIdsSchema = z
  .array(z.string().regex(TEAMS_ID_PATTERN))
  .max(MAX_TEAMS_RECIPIENTS, `Bir gönderimde en fazla ${MAX_TEAMS_RECIPIENTS} kişi seçilebilir`)
  .default([]);

/** "Kişiler" hedefine gönderirken seçilebilecek kişi. E-posta, Teams'teki (kurumsal) adres olmalı. */
export const TeamsContactSchema = z.object({
  id: z.string().regex(TEAMS_ID_PATTERN),
  name: DisplayNameSchema,
  email: z.email().max(254).transform((e) => e.toLowerCase()),
});
export type TeamsContact = z.infer<typeof TeamsContactSchema>;

/** Seçim listelerinde görünen ad, ör. "QA Ekibi · Kanal". */
export function teamsTargetLabel(t: { name: string; kind: TeamsTargetKind }): string {
  return `${t.name} · ${TEAMS_TARGET_KINDS[t.kind]}`;
}

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
  teams: z
    .object({
      targets: z.array(TeamsTargetSchema).max(MAX_TEAMS_TARGETS).default([]),
      contacts: z.array(TeamsContactSchema).max(MAX_TEAMS_CONTACTS).default([]),
    })
    .default({ targets: [], contacts: [] }),
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
