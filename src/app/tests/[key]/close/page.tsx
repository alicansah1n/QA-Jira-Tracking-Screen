import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { ISSUE_KEY_PATTERN } from "@/domain/analysis/schema";
import { getAnalysisStore } from "@/lib/server/context";
import { CloseWizard } from "./close-wizard";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  return { title: `${(await params).key.toUpperCase()} · Testi tamamla` };
}

export default async function ClosePage({ params }: { params: Promise<{ key: string }> }) {
  const key = (await params).key.toUpperCase();
  if (!ISSUE_KEY_PATTERN.test(key)) notFound();
  const entry = await getAnalysisStore().load(key);
  if (!entry?.ok) notFound();

  return (
    <>
      <Link href={`/tests/${key}`} className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-text">
        <ArrowLeft className="size-4" /> {key}
      </Link>
      <PageHeader
        eyebrow="Test Takibi"
        title="Testi tamamla ve maddeyi kapat"
        description={entry.analysis.issue.summary}
      />
      <CloseWizard issueKey={key} />
    </>
  );
}
