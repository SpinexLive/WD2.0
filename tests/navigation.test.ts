import { describe, expect, it } from "vitest";
import { matchesNav, navigationGroups, type NavAccess } from "@/lib/navigation";
import { hasNewsRole, NEWS_ROLE_ID } from "@/lib/permissions";

const member: NavAccess = { isAdmin: false, isReviewer: false, isOwner: false, canManageNews: false };
const links = (access: NavAccess) => navigationGroups(access).flatMap((g) => g.items.map((n) => n.href));

describe("grouped navigation access", () => {
  it("keeps standard members' links without staff groups", () => {
    expect(links(member).sort()).toEqual(["/observe", "/me", "/leaderboard"].sort());
    expect(navigationGroups(member).map((g) => g.id)).toEqual(["intelligence", "performance"]);
  });
  it("adds scouting for reviewers without adding staff tools", () => {
    expect(links({ ...member, isReviewer: true }).sort()).toEqual(["/observe", "/scouting", "/me", "/leaderboard"].sort());
  });
  it("gives staff all operational links but restricts News and Admin independently", () => {
    const staff = { ...member, isAdmin: true };
    expect(links(staff).sort()).toEqual(["/rosters", "/briefing", "/attendance", "/members", "/wdl", "/recruit", "/observe", "/scouting", "/feedback-setup", "/me", "/leaderboard"].sort());
    expect(links({ ...staff, canManageNews: true })).toContain("/news");
    expect(links({ ...staff, canManageNews: true })).not.toContain("/admin");
    expect(links({ ...staff, isOwner: true })).toContain("/admin");
    expect(links({ ...staff, isOwner: true })).not.toContain("/news");
  });
  it("uses the requested role alone for news permissions", () => {
    expect(hasNewsRole([NEWS_ROLE_ID])).toBe(true);
    expect(hasNewsRole(["1546188874986950758"])).toBe(false);
    expect(hasNewsRole([])).toBe(false);
  });
  it("recognises nested pages without confusing similar route prefixes", () => {
    expect(matchesNav("/rosters/event", "/rosters")).toBe(true);
    expect(matchesNav("/me", "/me")).toBe(true);
    expect(matchesNav("/members", "/me")).toBe(false);
    for (const g of navigationGroups({ ...member, isAdmin: true, isOwner: true, canManageNews: true })) expect(g.items.length).toBeGreaterThan(0);
  });
});
