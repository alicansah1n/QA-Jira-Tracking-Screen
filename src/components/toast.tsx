"use client";

import { CheckCircle2, Info, TriangleAlert, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cn } from "./ui";

type ToastTone = "success" | "error" | "info" | "warning";
type Toast = { id: number; tone: ToastTone; title: string; description?: string };

const ToastContext = createContext<(t: Omit<Toast, "id">) => void>(() => undefined);

export function useToast() {
  return useContext(ToastContext);
}

const icons = { success: CheckCircle2, error: XCircle, info: Info, warning: TriangleAlert };
const tones: Record<ToastTone, string> = {
  success: "text-success",
  error: "text-danger",
  info: "text-info",
  warning: "text-warning",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((all) => [...all.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === "error" ? 9000 : 5000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div key={t.id} className="animate-in pointer-events-auto flex gap-3 rounded-2xl border border-border bg-surface p-4 shadow-pop">
              <Icon className={cn("mt-0.5 size-5 shrink-0", tones[t.tone])} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t.title}</p>
                {t.description && <p className="mt-0.5 text-[13px] text-muted">{t.description}</p>}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-subtle hover:text-text" aria-label="Kapat">
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
