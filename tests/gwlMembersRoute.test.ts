import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), limit: vi.fn(), clan: vi.fn(), league: vi.fn(), apps: vi.fn(),
  links: vi.fn(), stats: vi.fn(), gwl: vi.fn(), sync: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: mocks.limit }));
vi.mock("@/server/services/discord", () => ({ getClanMembers: mocks.clan }));
vi.mock("@/server/services/wardogsLeague", () => ({
  getLeagueMembers: mocks.league, getLeagueApplications: mocks.apps, registrationStatus: () => "unknown",
}));
vi.mock("@/server/services/links", () => ({ resolveLinks: mocks.links }));
vi.mock("@/server/services/wardogsRcon", () => ({ getPlayerStats: mocks.stats }));
vi.mock("@/server/services/gwl", () => ({ getGwlMembers: mocks.gwl }));
vi.mock("@/server/services/matchHistory", () => ({ kickMatchSync: mocks.sync }));

import { GET } from "@/app/api/members/route";

const snap = <T>(data: T, stale = false) => ({ data, stale, fetchedAt: "2026-11-11T00:00:00Z" });
const ctx = { params: Promise.resolve({}) };
const request = () => new NextRequest("https://dashboard.test/api/members?refresh=1");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.limit.mockResolvedValue(0);
  mocks.session.mockResolvedValue({ discordId: "staff", isAdmin: true });
  mocks.clan.mockResolvedValue(snap([
    { id: "123456789012345678", displayName: "Linked", avatarUrl: null },
    { id: "123456789012345679", displayName: "Other", avatarUrl: null },
  ]));
  mocks.league.mockResolvedValue(snap([]));
  mocks.apps.mockResolvedValue(snap([]));
  mocks.links.mockResolvedValue({ steamIds: new Map(), source: { available: true } });
  mocks.gwl.mockResolvedValue(snap({ members: [{ name: "Player", role: "member", discordId: "123456789012345678" }] }));
});

describe("Members GWL status API", () => {
  it("matches Discord IDs, respects refresh and does not expose the GWL roster", async () => {
    const response = await GET(request(), ctx);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.gwl).toHaveBeenCalledWith(true);
    expect(body.members.map((member: { gwlStatus: string }) => member.gwlStatus)).toEqual(["linked", "not_matched"]);
    expect(JSON.stringify(body)).not.toContain('"name":"Player"');
  });

  it("shows unknown when the GWL API fails or returns stale data", async () => {
    mocks.gwl.mockRejectedValueOnce(new Error("GWL unavailable"));
    const unavailable = await (await GET(request(), ctx)).json();
    expect(unavailable.members[0].gwlStatus).toBe("unknown");
    expect(unavailable.sources.gwlMembers.error).toBe("GWL unavailable");
    mocks.gwl.mockResolvedValueOnce(snap({ members: [{ discordId: "123456789012345678" }] }, true));
    const stale = await (await GET(request(), ctx)).json();
    expect(stale.members[0].gwlStatus).toBe("unknown");
    expect(stale.sources.gwlMembers.stale).toBe(true);
  });

  it("does not grant regular members access to the data", async () => {
    mocks.session.mockResolvedValue({ discordId: "member", isAdmin: false, canViewMembers: false });
    expect((await GET(request(), ctx)).status).toBe(403);
    expect(mocks.gwl).not.toHaveBeenCalled();
  });

  it("allows the existing Members viewer role to see status only", async () => {
    mocks.session.mockResolvedValue({ discordId: "viewer", isAdmin: false, canViewMembers: true });
    const body = await (await GET(request(), ctx)).json();
    expect(body.members[0].gwlStatus).toBe("linked");
    expect(body.applications).toBeNull();
  });
});
