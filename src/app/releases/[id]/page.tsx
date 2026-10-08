import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ReleaseDetailView } from "./release-detail";

export const metadata: Metadata = { title: "Release" };

export default async function ReleaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  return <ReleaseDetailView id={id} />;
}
