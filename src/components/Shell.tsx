"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AppProvider, useApp } from "@/lib/client";
import { Avatar } from "./ui";

const NAV: { href: string; label: string; logo?: string }[] = [
  { href: "/members", label: "Members", logo: "/images/icons/wardogs.png" },
  { href: "/wdl", label: "WDL", logo: "/images/WDL.webp" },
  { href: "/rosters", label: "Rosters", logo: "/images/icons/infantry.png" },
  { href: "/briefing", label: "Briefing" },
  { href: "/attendance", label: "Attendance" },
  { href: "/recruit", label: "Recruit" },
  { href: "/news", label: "News" },
];
const TODAY_NAV: { href: string; label: string; logo?: string } = { href: "/today", label: "Today", logo: "/images/icons/accept.png" };
const ME_NAV: { href: string; label: string; logo?: string } = { href: "/me", label: "My stats" };
const BOARD_NAV: { href: string; label: string; logo?: string } = { href: "/leaderboard", label: "Leaderboard" };
const OBSERVE_NAV: { href: string; label: string; logo?: string } = { href: "/observe", label: "Match Feedback" };
const SCOUT_NAV: { href: string; label: string; logo?: string } = { href: "/scouting", label: "Scouting" };
const SETUP_NAV: { href: string; label: string; logo?: string } = { href: "/feedback-setup", label: "Feedback setup" };
const ADMIN_NAV: { href: string; label: string; logo?: string } = { href: "/admin", label: "Admin" };
const STAFF_TABS = [TODAY_NAV, NAV[2]!, NAV[3]!, BOARD_NAV];
const MEMBER_TABS = [TODAY_NAV, ME_NAV, BOARD_NAV];

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

function Inner({ children, isOwner, isAdmin, isReviewer, canViewAs, viewingAs }: { children: React.ReactNode; isOwner: boolean; isAdmin: boolean; isReviewer: boolean; canViewAs: boolean; viewingAs: string | null }) {
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

  const nav = (
    <nav className="flex flex-col gap-1 p-2 pt-3">
      {(isAdmin ? [TODAY_NAV, ...NAV, SETUP_NAV, BOARD_NAV, OBSERVE_NAV, SCOUT_NAV, ME_NAV, ...(isOwner ? [ADMIN_NAV] : [])] : [TODAY_NAV, ME_NAV, BOARD_NAV, OBSERVE_NAV, ...(isReviewer ? [SCOUT_NAV] : [])]).map((n) => (
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
        {isAdmin && (
          <button className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-bold uppercase tracking-wider text-stone/50" onClick={() => setOpen(true)}>
            <span className="text-base leading-5">☰</span>
            <span>More</span>
          </button>
        )}
      </nav>
    </div>
  );
}

export function Shell(props: { user: { id: string; displayName: string; username: string; avatarUrl: string }; csrfToken: string; isOwner?: boolean; isAdmin?: boolean; isReviewer?: boolean; canViewAs?: boolean; viewingAs?: string | null; children: React.ReactNode }) {
  return (
    <AppProvider value={{ user: props.user, csrfToken: props.csrfToken }}>
      <Inner isOwner={!!props.isOwner} isAdmin={props.isAdmin !== false} isReviewer={!!props.isReviewer} canViewAs={!!props.canViewAs} viewingAs={props.viewingAs ?? null}>{props.children}</Inner>
    </AppProvider>
  );
}
