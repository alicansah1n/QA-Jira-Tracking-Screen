/**
 * ISO haftaları (Pazartesi başlar). Hesaplar yerel saate göre yapılır; Jira da JQL tarihlerini kullanıcının
 * profil saat dilimine göre yorumlar. Saf fonksiyonlar: hem tarayıcıda hem sunucuda çalışır.
 */
export const WEEK_ID_PATTERN = /^(\d{4})-W(\d{2})$/;

const DAY = 86_400_000;

/** Tarihin ISO hafta kimliği, ör. "2026-W41". */
export function weekIdOf(date: Date): string {
  // Gün aritmetiği UTC'de yapılır; yaz saati geçişleri gün sayısını kaydırmaz.
  const d = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = (new Date(d).getUTCDay() + 6) % 7;
  const thursday = new Date(d + (3 - weekday) * DAY);
  const year = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function isWeekId(value: string): boolean {
  const m = WEEK_ID_PATTERN.exec(value);
  if (!m) return false;
  const week = Number(m[2]);
  return week >= 1 && week <= 53 && weekIdOf(weekStart(value)) === value;
}

/** Haftanın Pazartesi 00:00'ı (yerel). */
export function weekStart(id: string): Date {
  const m = WEEK_ID_PATTERN.exec(id);
  if (!m) throw new Error(`Geçersiz hafta: ${id}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(year, 0, 4);
  const firstMonday = 4 - ((jan4.getDay() + 6) % 7);
  return new Date(year, 0, firstMonday + (week - 1) * 7);
}

/** [başlangıç, bitiş) aralığı; bitiş bir sonraki Pazartesi 00:00. */
export function weekRange(id: string): { start: Date; end: Date } {
  const start = weekStart(id);
  return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7) };
}

export function shiftWeek(id: string, by: number): string {
  const start = weekStart(id);
  return weekIdOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() + by * 7));
}

/** Son `count` hafta, en eski başta; sonuncusu `current`. */
export function recentWeeks(current: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftWeek(current, i - count + 1));
}

const monthDay = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long" });
const dayOnly = new Intl.DateTimeFormat("tr-TR", { day: "numeric" });
const shortDay = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });

/** "5–11 Ekim 2026" ya da ay değişiyorsa "29 Eylül – 5 Ekim 2026". */
export function weekLabel(id: string): string {
  const { start } = weekRange(id);
  const last = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const year = last.getFullYear();
  return start.getMonth() === last.getMonth()
    ? `${dayOnly.format(start)}–${monthDay.format(last)} ${year}`
    : `${monthDay.format(start)} – ${monthDay.format(last)} ${year}`;
}

/** Grafik ekseni için kısa ad, ör. "6 Eki". */
export function weekShortLabel(id: string): string {
  return shortDay.format(weekStart(id));
}

export const weekNumber = (id: string) => Number(WEEK_ID_PATTERN.exec(id)?.[2] ?? 0);

/** JQL tarih biçimi: "yyyy/MM/dd HH:mm" (yerel). */
export function jqlDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Yerel YYYY-MM-DD. */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
