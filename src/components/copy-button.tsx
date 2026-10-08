"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "./ui";

/** Claude Code komutu gibi kısa metinleri panoya kopyalar. */
export function CopyCommand({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // pano erişimi yoksa sessiz geç
        }
      }}
      className={cn(
        "group inline-flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1 font-mono text-xs text-text transition-colors hover:border-accent hover:text-accent-text",
        className,
      )}
      title="Kopyala ve Claude Code sohbetine yapıştır"
    >
      <span>{value}</span>
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5 text-subtle group-hover:text-accent-text" />}
    </button>
  );
}
