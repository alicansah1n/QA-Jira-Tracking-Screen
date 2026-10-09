import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { SettingsView } from "./settings-view";

export const metadata: Metadata = { title: "Ayarlar" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Sistem"
        title="Ayarlar"
      />
      <SettingsView />
    </>
  );
}
