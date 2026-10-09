import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportsView } from "./reports-view";

export const metadata: Metadata = { title: "Haftalık Rapor" };

export default function ReportsPage() {
  // Seçili hafta adres çubuğunda (?week=2026-W41) tutulur; useSearchParams Suspense ister.
  return (
    <Suspense>
      <ReportsView />
    </Suspense>
  );
}
