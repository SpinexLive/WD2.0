import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";

const mocks = vi.hoisted(() => ({ session: vi.fn(), limit: vi.fn(), query: vi.fn(), publish: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: mocks.session }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: mocks.limit }));
vi.mock("@/lib/env", () => ({ env: () => ({ APP_URL: "https://example.com", DISCORD_ROSTER_ROLE_ID: "1349701919118983239" }) }));
vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/server/services/raidHelper", () => ({
  getEvents: async () => ({ data: [], fetchedAt: "now", stale: false }),
  getEventDetail: async () => ({ data: { signups: [] }, fetchedAt: "now", stale: false }),
}));
vi.mock("@/server/services/gwl", () => ({ getGwlMembers: async () => ({ data: { members: [] }, stale: false }) }));
vi.mock("@/server/services/rosters", () => ({
  eventIdSchema: z.string(), saveSchema: z.object({ version: z.number() }).passthrough(),
  getRoster: async () => ({ id: "r", version: 1, squads: [], messages: [] }),
  listTemplates: async () => [], createRoster: async () => ({ id: "r" }),
  saveRoster: async () => ({ id: "r", version: 2 }), deleteRoster: async () => ({ id: "r" }), resetRoster: async () => ({ id: "r" }),
}));
vi.mock("@/server/services/rosterPublish", () => ({
  publishSchema: z.object({ mode: z.string(), version: z.number() }), publishRoster: mocks.publish,
  enrichSignups: async () => ({ signups: [], leagueAvailable: true }), rosterStatsFor: async () => new Map(),
  loadForPublish: async () => ({ roster: { version: 1, messages: [] }, event: { channelId: null } }),
  buildPreview: async () => ({ embeds: [], names: {}, warnings: [] }),
  remindPending: async () => ({ reminded: 0 }),
}));

import { hasRosterRole } from "@/server/services/discord";
import { protectedRoute } from "@/lib/apiGuard";
import { GET as events } from "@/app/api/events/route";
import { GET as eligibility } from "@/app/api/loadout/eligibility/route";
import { GET, POST, PUT, DELETE } from "@/app/api/rosters/[eventId]/route";
import { GET as preview } from "@/app/api/rosters/[eventId]/preview/route";
import { POST as publish } from "@/app/api/rosters/[eventId]/publish/route";
import { POST as reset } from "@/app/api/rosters/[eventId]/reset/route";
import { POST as remind } from "@/app/api/rosters/[eventId]/remind/route";
import RosterLayout from "@/app/(dashboard)/rosters/layout";

const ctx = { params: Promise.resolve({ eventId: "event1" }) };
const request = (method: string, body?: unknown, headers: Record<string, string> = {}) => new NextRequest("https://example.com/api/rosters/event1", {
  method, headers: { origin: "https://example.com", "x-csrf-token": "csrf", "content-type": "application/json", ...headers },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const routes = [
  [events, "GET", undefined], [eligibility, "GET", undefined], [GET, "GET", undefined],
  [POST, "POST", { templateKey: "test" }], [PUT, "PUT", { version: 1 }], [DELETE, "DELETE", { version: 1 }],
  [preview, "GET", undefined], [publish, "POST", { mode: "update", version: 1 }],
  [reset, "POST", { version: 1 }], [remind, "POST", undefined],
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("React", React);
  mocks.limit.mockResolvedValue(0);
  mocks.query.mockResolvedValue([]);
  mocks.audit.mockResolvedValue(undefined);
  mocks.publish.mockResolvedValue({ action: "updated" });
});
afterEach(() => vi.unstubAllGlobals());

describe("roster manager permissions", () => {
  it("recognizes the dedicated role", () => {
    expect(hasRosterRole(["1349701919118983239"])).toBe(true);
    expect(hasRosterRole(["1349704360816414762"])).toBe(false);
  });

  it("protects the roster pages independently of other staff pages", async () => {
    mocks.session.mockResolvedValue({ isAdmin: false, canManageRosters: true });
    await expect(RosterLayout({ children: "roster" })).resolves.toBeTruthy();
    mocks.session.mockResolvedValue({ isAdmin: false, canManageRosters: false });
    await expect(RosterLayout({ children: "roster" })).rejects.toThrow("redirect:/me");
    mocks.session.mockResolvedValue(null);
    await expect(RosterLayout({ children: "roster" })).rejects.toThrow("redirect:/login");
  });

  it("grants the actual roster routes and their dependencies to roster managers and staff", async () => {
    for (const isAdmin of [false, true]) {
      mocks.session.mockResolvedValue({ discordId: "person", isAdmin, canManageRosters: !isAdmin, csrfToken: "csrf" });
      for (const [route, method, body] of routes) expect((await route(request(method, body), ctx)).status).toBe(200);
    }
    expect(mocks.publish).toHaveBeenCalledTimes(2);
  });

  it("denies every roster route to ordinary members and anonymous users", async () => {
    for (const session of [null, { discordId: "member", isAdmin: false, canManageRosters: false }]) {
      mocks.session.mockResolvedValue(session);
      for (const [route, method, body] of routes) expect((await route(request(method, body), ctx)).status).toBe(session ? 403 : 401);
    }
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("does not grant staff APIs and retains CSRF and view-as protections", async () => {
    const roster = { discordId: "person", isAdmin: false, canManageRosters: true, csrfToken: "csrf" };
    mocks.session.mockResolvedValue(roster);
    expect((await protectedRoute(async () => ({ ok: true }))(request("GET"), ctx)).status).toBe(403);
    expect((await publish(request("POST", { mode: "update", version: 1 }, { "x-csrf-token": "wrong" }), ctx)).status).toBe(403);
    expect((await publish(request("POST", { mode: "update", version: 1 }, { origin: "https://other.example" }), ctx)).status).toBe(403);
    mocks.session.mockResolvedValue({ ...roster, viewingAs: { adminId: "a" } });
    expect((await publish(request("POST", { mode: "update", version: 1 }), ctx)).status).toBe(403);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
