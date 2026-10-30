"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { matchesNav, navigationGroups, TODAY_NAV, type NavAccess, type NavItem } from "@/lib/navigation";

const GROUP_ICONS: Record<string, string> = {
  operations: "M12 3 3 8l9 5 9-5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5",
  people: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  intelligence: "M3 3v18h18M7 14l4-4 4 3 5-7",
  performance: "M5 20v-6h4v6M10 20V4h4v16M15 20V9h4v11",
  management: "M4 5h16M4 12h16M4 19h16M8 3v4M16 10v4M10 17v4",
};

export function SidebarNav({ access, onNavigate }: { access: NavAccess; onNavigate: () => void }) {
  const path = usePathname();
  const item = (n: NavItem, nested = false) => {
    const active = matchesNav(path, n.href);
    return (
      <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} onClick={onNavigate}
        className={`flex items-center gap-2.5 rounded-md py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blood-400 ${nested ? "px-2.5" : "px-3 font-semibold"} ${active ? "bg-blood-600/15 font-semibold text-stone shadow-[inset_2px_0_0_#b54550]" : "text-stone/55 hover:bg-ink-800 hover:text-stone"}`}>
        {n.logo ? <Image src={n.logo} alt="" width={18} height={18} className="h-[18px] w-[18px] shrink-0 object-contain" /> : <span aria-hidden="true" className={`ml-1.5 mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-blood-400" : "bg-ink-500"}`} />}
        {n.label}
      </Link>
    );
  };
  return (
    <nav aria-label="Dashboard" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-3">
      {item(TODAY_NAV)}
      <div className="mx-3 !mb-3 !mt-4 border-t border-ink-700/60" />
      {navigationGroups(access).map((group) => {
        const active = group.items.some((n) => matchesNav(path, n.href));
        return (
          <details key={`${group.id}:${active ? path : ""}`} open={active} className="group/section rounded-lg">
            <summary className={`flex cursor-pointer list-none items-center gap-2.5 rounded-md px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.08em] transition-colors hover:bg-ink-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blood-400 [&::-webkit-details-marker]:hidden ${active ? "text-stone" : "text-stone/55"}`}>
              <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={active ? "shrink-0 text-blood-300" : "shrink-0 text-stone/40"}><path d={GROUP_ICONS[group.id]} /></svg>
              <span className="flex-1">{group.label}</span>
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 transition-transform group-open/section:rotate-90"><path d="m7 4 6 6-6 6" /></svg>
            </summary>
            <div className="mb-2 ml-5 mr-1 space-y-0.5 border-l border-ink-600/70 py-1 pl-2">{group.items.map((n) => item(n, true))}</div>
          </details>
        );
      })}
    </nav>
  );
}
