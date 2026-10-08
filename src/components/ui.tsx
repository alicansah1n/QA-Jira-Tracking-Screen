import Link from "next/link";
import type {
  ButtonHTMLAttributes,
  ComponentProps,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

// ── Düzen ─────────────────────────────────────────────────────────────────────

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-border bg-surface shadow-card", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  action,
  icon: Icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text">
            <Icon className="size-4" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4 animate-in">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-xs font-medium uppercase tracking-[0.08em] text-accent-text">{eyebrow}</div>}
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </header>
  );
}

export function SectionTitle({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="text-[13px] text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// ── Butonlar ──────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
type ButtonSize = "sm" | "md" | "lg";

const buttonBase =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]";
const buttonVariants: Record<ButtonVariant, string> = {
  primary: "brand-grad text-white shadow-sm hover:brightness-110 hover:shadow-pop",
  secondary: "border border-border bg-surface text-text shadow-card hover:border-border-strong hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-text",
  danger: "bg-danger text-white shadow-sm hover:brightness-110",
  success: "bg-success text-white shadow-sm hover:brightness-110",
};
const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-9 px-4 text-sm",
  lg: "h-11 px-5 text-[15px]",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], className);
}

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  return (
    <button className={buttonClass(variant, size, className)} disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

// ── Rozetler ve durumlar ──────────────────────────────────────────────────────

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface-3 text-muted",
  accent: "bg-accent-soft text-accent-text",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

const dotClasses: Record<Tone, string> = {
  neutral: "bg-subtle",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export function Badge({ tone = "neutral", children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", toneClasses[tone], className)}>
      {dot && <span className={cn("size-1.5 rounded-full", dotClasses[tone])} aria-hidden />}
      {children}
    </span>
  );
}

/** Jira statü kategorisine göre renkli statü etiketi. */
export function StatusPill({ name, category }: { name: string; category?: string }) {
  const tone: Tone = category === "done" ? "success" : category === "indeterminate" ? "info" : "neutral";
  return (
    <Badge tone={tone} dot>
      {name}
    </Badge>
  );
}

export function Notice({ tone, title, children, icon: Icon }: { tone: Exclude<Tone, "neutral">; title: ReactNode; children?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className={cn("flex gap-3 rounded-xl px-4 py-3 text-sm", toneClasses[tone])} role={tone === "danger" ? "alert" : undefined}>
      {Icon && <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {children && <div className="mt-1 text-text/80">{children}</div>}
      </div>
    </div>
  );
}

export function Avatar({ name, url, size = 28 }: { name: string; url?: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toLocaleUpperCase("tr"))
    .join("");
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" width={size} height={size} className="shrink-0 rounded-full" referrerPolicy="no-referrer" />;
  }
  return (
    <span
      className="brand-grad grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
      aria-hidden
    >
      {initials || "?"}
    </span>
  );
}

// ── Veri gösterimi ────────────────────────────────────────────────────────────

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "accent",
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: LucideIcon;
  tone?: Tone;
  href?: string;
}) {
  const body = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] text-muted">{label}</p>
        <div className="mt-1 font-[family-name:var(--font-display)] text-[28px] font-semibold leading-none tracking-tight">{value}</div>
        {hint && <div className="mt-2 text-xs text-subtle">{hint}</div>}
      </div>
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", toneClasses[tone])}>
        <Icon className="size-5" aria-hidden />
      </span>
    </div>
  );
  return href ? (
    <Link href={href} className="group block rounded-2xl border border-border bg-surface p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop">
      {body}
    </Link>
  ) : (
    <Card className="p-5">{body}</Card>
  );
}

export type Segment = { value: number; className: string; label: string };

export function SegmentBar({ segments, total, className }: { segments: Segment[]; total: number; className?: string }) {
  return (
    <div className={cn("flex h-2 w-full overflow-hidden rounded-full bg-surface-3", className)} role="img" aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(", ")}>
      {total > 0 &&
        segments
          .filter((s) => s.value > 0)
          .map((s) => <span key={s.label} className={cn("h-full transition-all", s.className)} style={{ width: `${(s.value / total) * 100}%` }} title={`${s.label}: ${s.value}`} />)}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent-text">
        <Icon className="size-6" aria-hidden />
      </span>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      {description && <div className="mt-1.5 max-w-md text-sm text-muted">{description}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  // <span>: paragraf içinde de kullanılabilsin (<p> içinde <div> geçersiz HTML'dir).
  return <span className={cn("skeleton block", className)} aria-hidden />;
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-5" aria-busy="true" aria-label="Yükleniyor">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-9 w-9 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">{children}</kbd>;
}

export function IssueKey({ value, href }: { value: string; href?: string }) {
  const cls = "font-mono text-[13px] font-semibold text-accent-text";
  return href ? (
    <a href={href} target="_blank" rel="noreferrer noopener" className={cn(cls, "hover:underline")}>
      {value}
    </a>
  ) : (
    <span className={cls}>{value}</span>
  );
}

// ── Adım göstergesi ───────────────────────────────────────────────────────────

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Adımlar">
      {steps.map((label, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                "grid size-7 place-items-center rounded-full text-xs font-semibold",
                state === "done" && "bg-success text-white",
                state === "current" && "brand-grad text-white shadow-sm",
                state === "todo" && "bg-surface-3 text-muted",
              )}
              aria-current={state === "current" ? "step" : undefined}
            >
              {state === "done" ? "✓" : i + 1}
            </span>
            <span className={cn("text-sm", state === "current" ? "font-semibold" : "text-muted")}>{label}</span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-8 bg-border-strong" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

// ── Form ──────────────────────────────────────────────────────────────────────

const fieldBase =
  "w-full rounded-xl border border-border bg-surface px-3 text-sm text-text shadow-card outline-none transition-colors placeholder:text-subtle focus:border-accent focus:ring-4 focus:ring-accent/15 disabled:opacity-50";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, "py-2.5 leading-relaxed", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(fieldBase, "h-10 pr-8", className)} {...props} />;
}

export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Checkbox({ label, description, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl p-1">
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" {...props} />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}
