import type { Metadata } from "next";
import { ReleasesView } from "./releases-view";

export const metadata: Metadata = { title: "Release'ler" };

export default function ReleasesPage() {
  return <ReleasesView />;
}
