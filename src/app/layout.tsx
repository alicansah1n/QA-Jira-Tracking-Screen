import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "QA Asistanı", template: "%s · QA Asistanı" },
  description: "Jira test ve release süreçleri için kişisel takip ekranı",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <Providers>
          <div className="flex min-h-screen flex-col md:flex-row">
            <aside className="sidebar-bg px-3 py-4 md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:px-4 md:py-6">
              <Sidebar />
            </aside>
            <main className="min-w-0 flex-1">
              <div className="mx-auto max-w-310 px-4 py-6 md:px-10 md:py-10">{children}</div>
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
