const dateTime = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" });
const relative = new Intl.RelativeTimeFormat("tr-TR", { numeric: "auto" });

export function formatDateTime(value: string | undefined): string {
  if (!value) return "";
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? value : dateTime.format(ms);
}

/** "2026-10-07" gibi tarih (saat yok) değerlerini yerel gün olarak biçimlendirir. */
export function formatDate(value: string | undefined): string {
  if (!value) return "";
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return Number.isNaN(ms) ? value : dateOnly.format(ms);
}

/** "3 saat önce", "dün" gibi göreli zaman. */
export function formatRelative(value: string | undefined, now = Date.now()): string {
  if (!value) return "";
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  const diff = (ms - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "az önce";
  if (abs < 3600) return relative.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(diff / 3600), "hour");
  if (abs < 86_400 * 30) return relative.format(Math.round(diff / 86_400), "day");
  return formatDate(value);
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 6) return "İyi geceler";
  if (h < 12) return "Günaydın";
  if (h < 18) return "İyi günler";
  return "İyi akşamlar";
}
