"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarRange, ClipboardCheck, Inbox, LayoutDashboard, PackageCheck, Rocket, Settings, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/client/api";
import { Avatar, cn } from "./ui";

const GROUPS = [
  {
    title: "Günlük iş",
    items: [
      { href: "/", label: "Genel Bakış", icon: LayoutDashboard },
      { href: "/inbox", label: "Gelen Kutusu", icon: Inbox },
      { href: "/tests", label: "Test Takibi", icon: ClipboardCheck },
      { href: "/reports", label: "Haftalık Rapor", icon: CalendarRange },
    ],
  },
  {
    title: "Release",
    items: [
      { href: "/releases", label: "Release'ler", icon: PackageCheck },
      { href: "/releases/close", label: "Release Kapat", icon: Rocket },
    ],
  },
  { title: "Sistem", items: [{ href: "/settings", label: "Ayarlar", icon: Settings }] },
] as const;

const ALL = GROUPS.flatMap((g) => g.items.map((i) => i.href as string));

/** Yola uyan en uzun menü öğesi aktiftir ("/releases/close" açıkken "/releases" aktif olmaz). */
function activeHref(pathname: string): string | undefined {
  return ALL.filter((href) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`))).sort(
    (a, b) => b.length - a.length,
  )[0];
}

type Me = { connected: true; displayName: string; avatarUrl?: string } | { connected: false };

export function Sidebar() {
  const pathname = usePathname();
  const current = activeHref(pathname);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me"), staleTime: 5 * 60_000, retry: false });
  const data = me.data;

  return (
    <div className="flex h-full flex-col">
      <Link href="/" className="mb-6 flex items-center gap-3 px-2 md:mb-8">
        <span className="brand-grad grid size-9 place-items-center rounded-xl text-white shadow-lg shadow-black/20">
          <Sparkles className="size-4.5" aria-hidden />
        </span>
        <span>
          <span className="block text-[15px] font-semibold leading-tight text-white">QA Asistanı</span>
          <span className="block text-xs text-sidebar-muted">Jira · Test · Release</span>
        </span>
      </Link>

      <nav className="flex gap-1 overflow-x-auto md:flex-1 md:flex-col md:gap-6 md:overflow-visible" aria-label="Ana menü">
        {GROUPS.map((group) => (
          <div key={group.title} className="flex gap-1 md:flex-col">
            <p className="mb-1 hidden px-3 text-[11px] font-semibold uppercase tracking-widest text-sidebar-muted/80 md:block">{group.title}</p>
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = href === current;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                    active ? "bg-sidebar-active font-medium text-white" : "text-sidebar-text hover:bg-white/5 hover:text-white",
                  )}
                >
                  {active && <span className="brand-grad absolute top-1.5 bottom-1.5 left-0 hidden w-1 rounded-full md:block" aria-hidden />}
                  <Icon className="size-4.5" aria-hidden />
                  {label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="mt-6 hidden rounded-2xl border border-white/10 bg-white/5 p-3 md:block">
        {me.isPending ? (
          <div className="h-9" />
        ) : data?.connected ? (
          <div className="flex items-center gap-3">
            <Avatar name={data.displayName} url={data.avatarUrl} size={34} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{data.displayName}</p>
              <p className="flex items-center gap-1.5 text-xs text-sidebar-muted">
                <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden /> Jira'ya bağlı
              </p>
            </div>
          </div>
        ) : (
          <Link href="/settings" className="flex items-center gap-3">
            <span className="grid size-8.5 place-items-center rounded-full bg-white/10 text-sm text-white">!</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-white">Bağlantı yok</span>
              <span className="block text-xs text-sidebar-muted">Ayarları kontrol edin</span>
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}
