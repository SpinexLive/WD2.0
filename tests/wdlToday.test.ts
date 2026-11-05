import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ events: vi.fn(), fixtures: vi.fn(), players: vi.fn(), query: vi.fn() }));
vi.mock("@/server/services/raidHelper", () => ({ getEvents: mocks.events }));
vi.mock("@/server/services/wardogsLeague", () => ({ getLeagueFixtures: mocks.fixtures }));
vi.mock("@/server/services/compare", () => ({ getClanPlayers: mocks.players }));
vi.mock("@/server/services/voice", () => ({ getVoice: () => null }));
vi.mock("@/server/services/rosters", () => ({ getRoster: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/env", () => ({ env: () => ({ DISCORD_GUILD_ID: "1332320879073296404" }) }));

import { buildToday } from "@/server/services/today";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.events.mockResolvedValue({ data: [] });
  mocks.players.mockResolvedValue([]);
  mocks.query.mockResolvedValue([]);
});

describe("Today League fixture", () => {
  it("shows the nearest upcoming scheduled fixture and its posted signup link", async () => {
    const near = { id: "near", status: "SCHEDULED", scheduledAt: new Date(Date.now() + 3600_000).toISOString() };
    const later = { id: "later", status: "SCHEDULED", scheduledAt: new Date(Date.now() + 7200_000).toISOString() };
    mocks.fixtures.mockResolvedValue({ data: { upcoming: [later, near], recent: [] }, stale: false });
    mocks.query.mockResolvedValue([{ event_id: "123456789012345678", event_channel_id: "1546479425644793877" }]);
    const result = await buildToday("member");
    expect(result.league.fixture?.id).toBe("near");
    expect(result.league.eventUrl).toBe("https://discord.com/channels/1332320879073296404/1546479425644793877/123456789012345678");
  });

  it("keeps the rest of Today available and reports WDL outages", async () => {
    mocks.fixtures.mockRejectedValue(new Error("WDL unavailable"));
    const result = await buildToday("member");
    expect(result.league).toEqual({ fixture: null, stale: false, error: "WDL unavailable", eventUrl: null });
    expect(result.next).toBeNull();
  });
});
