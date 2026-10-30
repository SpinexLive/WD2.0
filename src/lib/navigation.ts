export interface NavItem { href: string; label: string; logo?: string }
export interface NavGroup { id: string; label: string; items: NavItem[] }
export interface NavAccess { isAdmin: boolean; isReviewer: boolean; isOwner: boolean; canManageNews: boolean }

export const TODAY_NAV: NavItem = { href: "/today", label: "Today", logo: "/images/icons/accept.png" };
export const ME_NAV: NavItem = { href: "/me", label: "My stats" };
export const BOARD_NAV: NavItem = { href: "/leaderboard", label: "Leaderboard" };
const ROSTER_NAV: NavItem = { href: "/rosters", label: "Rosters", logo: "/images/icons/infantry.png" };
const BRIEFING_NAV: NavItem = { href: "/briefing", label: "Briefing" };
export const STAFF_TABS = [TODAY_NAV, ROSTER_NAV, BRIEFING_NAV, BOARD_NAV];
export const MEMBER_TABS = [TODAY_NAV, ME_NAV, BOARD_NAV];

export const matchesNav = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

export function navigationGroups(access: NavAccess): NavGroup[] {
  const groups: NavGroup[] = [];
  if (access.isAdmin) {
    groups.push(
      { id: "operations", label: "Operations", items: [ROSTER_NAV, BRIEFING_NAV, { href: "/attendance", label: "Attendance" }] },
      { id: "people", label: "People & league", items: [
        { href: "/members", label: "Members", logo: "/images/icons/wardogs.png" },
        { href: "/wdl", label: "WDL", logo: "/images/WDL.webp" },
        { href: "/recruit", label: "Recruit" },
      ] },
    );
  }
  groups.push({ id: "intelligence", label: "Match intelligence", items: [
    { href: "/observe", label: "Match Feedback" },
    ...(access.isAdmin || access.isReviewer ? [{ href: "/scouting", label: "Scouting" }] : []),
    ...(access.isAdmin ? [{ href: "/feedback-setup", label: "Feedback setup" }] : []),
  ] });
  groups.push({ id: "performance", label: "Performance", items: [ME_NAV, BOARD_NAV] });
  const management = [
    ...(access.isAdmin && access.canManageNews ? [{ href: "/news", label: "News" }] : []),
    ...(access.isAdmin && access.isOwner ? [{ href: "/admin", label: "Admin" }] : []),
  ];
  if (management.length) groups.push({ id: "management", label: "Management", items: management });
  return groups;
}
