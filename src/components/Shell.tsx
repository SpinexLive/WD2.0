"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AppProvider, useApp } from "@/lib/client";
import { Avatar } from "./ui";

const NAV: { href: string; label: string; logo?: string }[] = [
  { href: "/members", label: "Members", logo: "/images/icons/wardogs.png" },
  { href: "/wdl", label: "WDL", logo: "/images/WDL.webp" },
  { href: "/rosters", label: "Rosters", logo: "/images/icons/infantry.png" },
];
const ADMIN_NAV: { href: string; label: string; logo?: string } = { href: "/admin", label: "Admin" };

function Inner({ children, isOwner }: { children: React.ReactNode; isOwner: boolean }) {
  const { user, csrfToken } = useApp();
  const path = usePathname();
  const [open, setOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": csrfToken } }).catch(() => undefined);
    window.location.href = "/login";
  }

  const nav = (
    <nav className="flex flex-col gap-1 p-2 pt-3">
      {(isOwner ? [...NAV, ADMIN_NAV] : NAV).map((n) => (
        <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className={`group relative rounded-lg px-3 py-2 text-[12px] font-bold uppercase tracking-[0.14em] transition ${path.startsWith(n.href) ? "bg-gradient-to-r from-blood-600/30 to-transparent text-stone before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-blood-500" : "text-stone/55 hover:bg-ink-800/80 hover:text-stone"}`}>
          <span className="flex items-center gap-2"><Image src={n.logo ?? "/images/grey.png"} alt="" width={22} height={22} className="h-[22px] w-[22px] object-contain" />{n.label}</span>
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen md:h-screen md:overflow-hidden">
      <aside className="sticky top-0 hidden h-screen w-52 shrink-0 border-r border-ink-700/80 bg-gradient-to-b from-ink-900 to-ink-950 md:block">
        <div className="flex items-center gap-3 border-b border-ink-700 px-4 py-3"><Image src="/images/icon.png" alt="" width={32} height={32} priority /><div><div className="text-lg font-bold leading-none tracking-[0.25em] text-stone">REMNANT</div><div className="mt-1 text-[10px] uppercase tracking-[0.3em] text-blood-400">Command</div></div></div>
        {nav}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setOpen(false)}>
          <div className="h-full w-52 border-r border-ink-700 bg-ink-950" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-ink-700 px-4 py-3"><Image src="/images/icon.png" alt="" width={32} height={32} priority /><div><div className="text-lg font-bold leading-none tracking-[0.25em] text-stone">REMNANT</div><div className="mt-1 text-[10px] uppercase tracking-[0.3em] text-blood-400">Command</div></div></div>
            {nav}
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col md:min-h-0">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-700/80 bg-ink-950/80 px-4 py-1.5 shadow-[0_1px_0_0_rgba(158,48,60,0.35)] backdrop-blur-md">
          <button className="btn-ghost md:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>☰</button>
          <div className="hidden md:block" />
          <div className="flex items-center gap-2.5 rounded-full border border-ink-700 bg-ink-850/80 py-0.5 pl-1 pr-1 md:pr-1">
            <Avatar src={user.avatarUrl} size={26} />
            <span className="max-w-[10rem] truncate text-sm">{user.displayName}</span>
            <button className="btn-ghost !rounded-full !px-3 !py-1" onClick={logout}>Log out</button>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:min-h-0 md:overflow-y-auto md:p-4">{children}</main>
      </div>
    </div>
  );
}

export function Shell(props: { user: { id: string; displayName: string; username: string; avatarUrl: string }; csrfToken: string; isOwner?: boolean; children: React.ReactNode }) {
  return (
    <AppProvider value={{ user: props.user, csrfToken: props.csrfToken }}>
      <Inner isOwner={!!props.isOwner}>{props.children}</Inner>
    </AppProvider>
  );
}
