"use client";

import { Check } from "lucide-react";
import { MAX_TEAMS_RECIPIENTS, type TeamsContact } from "@/domain/settings/schema";
import { cn } from "./ui";

/** Seçimden, artık kişi listesinde olmayanları (başka sekmede silinmiş) atar. */
export function validContactIds(contacts: TeamsContact[], ids: string[]): string[] {
  return ids.filter((id) => contacts.some((c) => c.id === id));
}

/** "Kişiler" hedefine gönderirken kayıtlı kişi listesinden alıcı seçimi. */
export function RecipientPicker({
  contacts,
  value,
  onChange,
  max = MAX_TEAMS_RECIPIENTS,
}: {
  contacts: TeamsContact[];
  value: string[];
  onChange: (ids: string[]) => void;
  max?: number;
}) {
  if (!contacts.length) {
    return <p className="text-xs text-muted">Kişi listesi boş. Ayarlar sayfasındaki Teams kişileri bölümünden ekleyin.</p>;
  }
  const valid = validContactIds(contacts, value);
  const selected = new Set(valid);
  const full = valid.length >= max;
  const allSelected = valid.length === Math.min(contacts.length, max);
  const toggle = (id: string) => onChange(selected.has(id) ? valid.filter((v) => v !== id) : [...valid, id]);

  return (
    <div className="space-y-2" role="group" aria-label="Alıcılar">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {valid.length} / {contacts.length} kişi seçili
          {contacts.length > max && ` · en fazla ${max}`}
        </span>
        <button
          type="button"
          className="font-medium text-accent-text hover:underline"
          onClick={() => onChange(allSelected ? [] : contacts.slice(0, max).map((c) => c.id))}
        >
          {allSelected ? "Seçimi temizle" : contacts.length > max ? `İlk ${max} kişiyi seç` : "Tümünü seç"}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {contacts.map((c) => {
          const on = selected.has(c.id);
          const disabled = !on && full;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              title={disabled ? `En fazla ${max} kişi seçilebilir` : c.email}
              onClick={() => toggle(c.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                on ? "border-accent bg-accent-soft font-medium text-accent-text" : "border-border text-muted hover:border-border-strong hover:text-text",
              )}
            >
              {on && <Check className="size-3" />}
              {c.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
