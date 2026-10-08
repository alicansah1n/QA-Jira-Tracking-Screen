"use client";

import { useMutation } from "@tanstack/react-query";
import { ClipboardPaste, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, CardHeader, Notice, Textarea } from "@/components/ui";
import { api, ApiRequestError } from "@/lib/client/api";

/** claude.ai gibi başka bir yerden kopyalanan analiz JSON'unu doğrulayıp kaydeder. */
export function JsonImport() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [parseError, setParseError] = useState<string>();

  const save = useMutation({
    mutationFn: (input: { analysis: unknown; overwrite: boolean }) => api<{ key: string }>("/api/analyses", { method: "POST", json: input }),
    onSuccess: ({ key }) => {
      setValue("");
      setOpen(false);
      router.push(`/tests/${key}`);
      router.refresh();
    },
  });

  function submit(overwrite: boolean) {
    setParseError(undefined);
    let analysis: unknown;
    try {
      analysis = JSON.parse(value);
    } catch {
      setParseError("Metin geçerli JSON değil");
      return;
    }
    save.mutate({ analysis, overwrite });
  }

  const error = save.error instanceof ApiRequestError ? save.error : undefined;
  const exists = error?.body.code === "EXISTS";
  const details = Array.isArray(error?.body.details) ? (error.body.details as string[]) : [];

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <ClipboardPaste className="size-4" /> JSON yapıştır
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Analiz JSON'u yapıştır">
          <Card className="animate-in w-full max-w-2xl shadow-pop">
            <CardHeader
              title="Analiz JSON'u yapıştır"
              description="docs/schemas/issue-analysis.schema.json sözleşmesine uymalı. Kaydetmeden önce doğrulanır."
              action={
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)} aria-label="Kapat">
                  <X className="size-4" />
                </Button>
              }
            />
            <div className="space-y-3 p-5">
              <Textarea
                className="h-72 font-mono text-xs"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder='{ "schemaVersion": 1, "issue": { "key": "PROJ-123", … }, … }'
                spellCheck={false}
                autoFocus
              />
              {parseError && <Notice tone="danger" title={parseError} />}
              {error && !exists && (
                <Notice tone="danger" title={error.message}>
                  {details.length > 1 && (
                    <ul className="list-inside list-disc font-mono text-xs">
                      {details.slice(0, 10).map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  )}
                </Notice>
              )}
              {exists && (
                <Notice tone="warning" title={error.message}>
                  Mevcut analizin üzerine yazmak istiyor musunuz?
                </Notice>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Vazgeç
                </Button>
                {exists ? (
                  <Button variant="danger" onClick={() => submit(true)} loading={save.isPending}>
                    Üzerine yaz
                  </Button>
                ) : (
                  <Button variant="primary" onClick={() => submit(false)} loading={save.isPending} disabled={!value.trim()}>
                    Doğrula ve kaydet
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
