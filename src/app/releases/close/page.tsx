import type { Metadata } from "next";
import { Suspense } from "react";
import { ReleaseCloseView } from "./release-close-view";

export const metadata: Metadata = { title: "Release Kapat" };

export default function ReleaseClosePage() {
  return (
    <Suspense>
      <ReleaseCloseView />
    </Suspense>
  );
}
