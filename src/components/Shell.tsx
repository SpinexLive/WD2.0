"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AppProvider, useApp } from "@/lib/client";
import { Avatar } from "./ui";
import { SidebarNav } from "./SidebarNav";
import { STAFF_TABS, MEMBER_TABS } from "@/lib/navigation";

function ViewAsPicker({ csrfToken }: { csrfToken: string }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<{ id: string; name: string; avatarUrl: string }[] | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open || list) return;
    fetch("/api/auth/view-as", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => (j.members ? setList(j.members) : setErr(j.error?.message ?? "Could not load members")))
      .catch(() => setErr("Could not load members"));
  }, [open, list]);
  async function start(id: string) {
    const r = await fetch("/api/auth/view-as", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }, body: JSON.stringify({ discordId: id }) });
    if (r.ok) window.location.href = "/today";
    else setErr((await r.json().catch(() => null))?.error?.message ?? "Failed");
  }
  const shown = (list ?? []).filter((m) => m.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  return (
    <div className="relative">
      <button className="btn-ghost !px-3 !py-1" onClick={() => setOpen((o) => !o)} aria-expanded={open}>View as</button>
      {open && (
        <div className="absolute left-0 z-40 mt-1 w-64 rounded-lg border border-ink-600 bg-ink-900 p-2 shadow-xl">
          <input autoFocus className="input mb-2" placeholder="Search member" aria-label="Search member" value={q} onChange={(e) => setQ(e.target.value)} />
          {err && <p className="px-1 pb-1 text-xs text-blood-300">{err}</p>}
          {!list && !err && <p className="px-1 text-xs text-stone/50">Loading…</p>}
          <ul>
            {shown.map((m) => (
              <li key={m.id}>
                <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-ink-800" onClick={() => void start(m.id)}>
                  <Avatar src={m.avatarUrl} size={22} />
                  <span className="truncate">{m.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Inner({ children, isOwner, isAdmin, isReviewer, canManageNews, canViewAs, viewingAs }: { children: React.ReactNode; isOwner: boolean; isAdmin: boolean; isReviewer: boolean; canManageNews: boolean; canViewAs: boolean; viewingAs: string | null }) {
  const { user, csrfToken } = useApp();
  const path = usePathname();
  const [open, setOpen] = useState(false);

  async function exitView() {
    await fetch("/api/auth/view-as", { method: "DELETE", headers: { "X-CSRF-Token": csrfToken } }).catch(() => undefined);
    window.location.href = "/today";
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": csrfToken } }).catch(() => undefined);
    window.location.href = "/";
  }

  const nav = <SidebarNav access={{ isAdmin, isReviewer, isOwner, canManageNews }} onNavigate={() => setOpen(false)} />;

  return (
    <div className="flex min-h-screen md:h-screen md:overflow-hidden">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-ink-700/80 bg-gradient-to-b from-ink-900 to-ink-950 md:flex">
        <div className="flex items-center gap-3 border-b border-ink-700 px-4 py-3"><Image src="/images/icon.png" alt="" width={32} height={32} priority /><div><div className="text-lg font-bold leading-none tracking-[0.25em] text-stone">REMNANT</div><div className="mt-1 text-[10px] uppercase tracking-[0.3em] text-blood-400">Command</div></div></div>
        {nav}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setOpen(false)}>
          <div className="flex h-full w-60 flex-col border-r border-ink-700 bg-ink-950" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-ink-700 px-4 py-3"><Image src="/images/icon.png" alt="" width={32} height={32} priority /><div><div className="text-lg font-bold leading-none tracking-[0.25em] text-stone">REMNANT</div><div className="mt-1 text-[10px] uppercase tracking-[0.3em] text-blood-400">Command</div></div></div>
            {nav}
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col md:min-h-0">
        {viewingAs && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-blood-700 px-4 py-1.5 text-sm font-semibold text-white" role="status">
            <span>Viewing as {user.displayName} (read-only). Signed in as {viewingAs}.</span>
            <button className="rounded bg-white/15 px-3 py-0.5 hover:bg-white/25" onClick={() => void exitView()}>Exit view</button>
          </div>
        )}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-700/80 bg-ink-950/80 px-4 py-1.5 shadow-[0_1px_0_0_rgba(158,48,60,0.35)] backdrop-blur-md">
          <button className="btn-ghost md:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>☰</button>
          {canViewAs && !viewingAs ? <ViewAsPicker csrfToken={csrfToken} /> : <div className="hidden md:block" />}
          <div className="flex items-center gap-2.5 rounded-full border border-ink-700 bg-ink-850/80 py-0.5 pl-1 pr-1 md:pr-1">
            <Avatar src={user.avatarUrl} size={26} />
            <span className="max-w-[10rem] truncate text-sm">{user.displayName}</span>
            <button className="btn-ghost !rounded-full !px-3 !py-1" onClick={logout}>Log out</button>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 pb-24 md:min-h-0 md:overflow-y-auto md:p-4 md:pb-4">{children}</main>
      </div>
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-ink-700 bg-ink-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        {(isAdmin ? STAFF_TABS : MEMBER_TABS).map((n) => {
          const on = path.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-bold uppercase tracking-wider ${on ? "text-stone" : "text-stone/50"}`}>
              <Image src={n.logo ?? "/images/grey.png"} alt="" width={20} height={20} className={`h-5 w-5 object-contain ${on ? "" : "opacity-60"}`} />
              <span className={on ? "border-b-2 border-blood-500" : ""}>{n.label}</span>
            </Link>
          );
        })}
          <button className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-bold uppercase tracking-wider text-stone/50" aria-label="Open all navigation" aria-expanded={open} onClick={() => setOpen(true)}>
            <span className="text-base leading-5">☰</span>
            <span>More</span>
          </button>
      </nav>
    </div>
  );
}

export function Shell(props: { user: { id: string; displayName: string; username: string; avatarUrl: string }; csrfToken: string; isOwner?: boolean; isAdmin?: boolean; isReviewer?: boolean; canManageNews?: boolean; canViewAs?: boolean; viewingAs?: string | null; children: React.ReactNode }) {
  return (
    <AppProvider value={{ user: props.user, csrfToken: props.csrfToken }}>
      <Inner isOwner={!!props.isOwner} isAdmin={props.isAdmin !== false} isReviewer={!!props.isReviewer} canManageNews={!!props.canManageNews} canViewAs={!!props.canViewAs} viewingAs={props.viewingAs ?? null}>{props.children}</Inner>
    </AppProvider>
  );
}
