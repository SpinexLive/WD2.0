import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ session: vi.fn(), limit: vi.fn(), event: vi.fn(), roster: vi.fn(), templates: vi.fn(), enrich: vi.fn(), stats: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: mocks.limit }));
vi.mock("@/server/services/raidHelper", () => ({ getEventDetail: mocks.event }));
vi.mock("@/server/services/rosterPublish", () => ({ enrichSignups: mocks.enrich, rosterStatsFor: mocks.stats }));
vi.mock("@/server/services/rosters", async (original) => {
  const actual = await original<typeof import("@/server/services/rosters")>();
  return { ...actual, getRoster: mocks.roster, listTemplates: mocks.templates };
});

import { GET } from "@/app/api/rosters/[eventId]/route";

const signed = "100000000000000001";
const removed = "100000000000000002";
const context = { params: Promise.resolve({ eventId: "event1" }) };
const request = (refresh = false) => new NextRequest(`https://dashboard.test/api/rosters/event1${refresh ? "?refresh=1" : ""}`);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ discordId: signed, isAdmin: true });
  mocks.limit.mockResolvedValue(0);
  mocks.event.mockResolvedValue({ data: { id: "event1", title: "Event", signups: [{ discordId: signed }] }, stale: false, fetchedAt: "2026-01-01" });
  mocks.roster.mockResolvedValue({ squads: [{ slots: [{ discordId: signed }, { discordId: removed }, { discordId: null }, null] }] });
  mocks.templates.mockResolvedValue([]);
  mocks.enrich.mockResolvedValue({ signups: [{ discordId: signed, kd: 1.5 }], leagueAvailable: true });
  mocks.stats.mockResolvedValue(new Map([[removed, { kd: 0, deaths: 1 }]]));
});

describe("roster comparison stats", () => {
  it("looks up assigned players no longer signed up, without re-requesting signups or mercenaries", async () => {
    const response = await GET(request(true), context);
    expect(response.status).toBe(200);
    expect(mocks.stats).toHaveBeenCalledWith([removed], true);
    const data = await response.json();
    expect(data.assignedKd).toEqual({ [removed]: 0 });
    expect(data.signups).toEqual([{ discordId: signed, kd: 1.5 }]);
  });

  it("still obtains assigned-player stats when Raid Helper is unavailable", async () => {
    mocks.event.mockRejectedValue(new Error("Raid Helper unavailable"));
    const response = await GET(request(), context);
    const data = await response.json();
    expect(mocks.stats).toHaveBeenCalledWith([signed, removed], false);
    expect(data.signups).toBeNull();
    expect(data.eventError).toContain("Raid Helper unavailable");
    expect(data.assignedKd).toEqual({ [removed]: 0 });
    expect(mocks.enrich).not.toHaveBeenCalled();
  });
});
