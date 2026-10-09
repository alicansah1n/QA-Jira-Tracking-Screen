"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "./ui";

/** Eksen için "yuvarlak" üst sınır: 1, 2, 5 × 10ⁿ. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const f = value / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

export function signed(n: number): string {
  return n > 0 ? `+${nf.format(n)}` : nf.format(n);
}

// ── Sütun grafiği ───────────────────────────────────────────────────────────

export type Column = {
  key: string;
  /** X ekseni etiketi. */
  label: string;
  value: number;
  /** Üzerine gelince görünen ayrıntı. */
  tooltip: ReactNode;
  /** Devam eden dönem (ör. bu hafta): soluk çizilir, etiketi kalın. */
  partial?: boolean;
};

/**
 * Tek seri, tek eksen sütun grafiği. Değer yalnızca devam eden / seçili sütunun üstünde yazar; diğerleri
 * üzerine gelince ya da klavyeyle odaklanınca görünür. `onSelect` verilirse sütunlar tıklanabilir.
 */
export function ColumnChart({
  columns,
  ariaLabel,
  onSelect,
  height = "h-40",
  format = (v) => nf.format(v),
}: {
  columns: Column[];
  ariaLabel: string;
  onSelect?: (key: string) => void;
  height?: string;
  format?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const top = niceMax(Math.max(...columns.map((c) => c.value), 0));
  const ticks = [top, top / 2, 0];
  const active = hover !== null ? columns[hover] : undefined;

  return (
    <div className="relative" role="group" aria-label={ariaLabel}>
      <div className="flex gap-2">
        <div className={cn("flex w-7 flex-col justify-between text-right text-[11px] text-subtle tabular-nums", height)} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="-translate-y-1/2 leading-none first:translate-y-0 last:translate-y-0">
              {nf.format(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className={cn("pointer-events-none absolute inset-x-0 top-0", height)} aria-hidden>
            {ticks.map((t, i) => (
              <div key={t} className="absolute inset-x-0 border-t border-border" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }} />
            ))}
          </div>
          <div className={cn("relative flex gap-0.5", height)} onMouseLeave={() => setHover(null)}>
            {columns.map((c, i) => {
              const showValue = c.partial || hover === i;
              const Tag = onSelect ? "button" : "div";
              return (
                <Tag
                  key={c.key}
                  {...(onSelect ? { type: "button" as const, onClick: () => onSelect(c.key) } : { tabIndex: 0, role: "img" })}
                  className={cn(
                    "group relative flex h-full flex-1 flex-col items-center justify-end rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40",
                    hover === i && "bg-surface-2",
                    onSelect && "cursor-pointer",
                  )}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  aria-label={`${c.label}: ${format(c.value)}`}
                >
                  <span className={cn("mb-1 text-[11px] font-semibold tabular-nums", showValue ? "text-text" : "invisible")}>{format(c.value)}</span>
                  <span
                    className="w-full max-w-7 rounded-t-sm transition-[filter] group-hover:brightness-110"
                    style={{
                      height: `${(c.value / top) * 82}%`,
                      minHeight: c.value ? 3 : 0,
                      background: "var(--viz-1)",
                      opacity: c.partial ? 0.55 : 1,
                    }}
                  />
                </Tag>
              );
            })}
          </div>
          <div className="mt-1.5 flex gap-0.5 text-[11px] text-subtle" aria-hidden>
            {columns.map((c, i) => (
              <span key={c.key} className={cn("flex-1 truncate text-center tabular-nums", c.partial && "font-semibold text-text", i % 2 === 1 && !c.partial && "max-sm:invisible")}>
                {c.label}
              </span>
            ))}
          </div>
          {active && hover !== null && (
            <div
              className="pointer-events-none absolute -top-2 z-10 w-48 -translate-x-1/2 -translate-y-full rounded-xl border border-border bg-surface p-2.5 text-xs shadow-pop"
              style={{ left: `clamp(6rem, ${((hover + 0.5) / columns.length) * 100}%, calc(100% - 6rem))` }}
            >
              {active.tooltip}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Değişim ─────────────────────────────────────────────────────────────────

/** Önceki döneme göre değişim. Renk: yön × artışın iyi olup olmadığı (nötrse gri); ok simgesiyle birlikte. */
export function Delta({
  current,
  previous,
  upIsGood = true,
  neutral,
  suffix = "geçen hafta",
}: {
  current: number;
  previous: number;
  upIsGood?: boolean;
  neutral?: boolean;
  suffix?: string;
}) {
  const diff = Math.round((current - previous) * 100) / 100;
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  const good = diff === 0 || neutral ? undefined : diff > 0 === upIsGood;
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-xs font-medium tabular-nums", good === undefined ? "text-subtle" : good ? "text-success" : "text-danger")}
      title={`${suffix}: ${nf.format(previous)}`}
    >
      <Icon className="size-3.5" aria-hidden />
      {diff === 0 ? "aynı" : signed(diff)}
      <span className="font-normal text-subtle">&nbsp;{suffix}</span>
    </span>
  );
}
