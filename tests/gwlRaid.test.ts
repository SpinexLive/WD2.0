import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GwlFixture } from "@/server/services/gwl";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), fixtures: vi.fn(), names: vi.fn(), posted: vi.fn(), scheduled: vi.fn(),
  create: vi.fn(), raw: vi.fn(), audit: vi.fn(), lock: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ env: () => ({ APP_URL: "https://dashboard.test", DISCORD_GUILD_ID: "1332320879073296404" }) }));
vi.mock("@/lib/db", () => ({
  query: mocks.query, independentQuery: mocks.query, withLeagueEventLock: mocks.lock,
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/server/services/gwl", () => ({ getGwlFixtures: mocks.fixtures }));
vi.mock("@/server/services/wdlRaidHelper", async (original) => {
  const actual = await original<typeof import("@/server/services/wdlRaidHelper")>();
  return { ...actual, wdlEventNames: mocks.names, getPostedWdlEvents: mocks.posted,
    getScheduledWdlEvents: mocks.scheduled, createWdlRaidEvent: mocks.create, getRawWdlEvent: mocks.raw };
});

import { gwlEventBody } from "@/server/services/gwlRaidHelper";
import { gwlFixtureTick } from "@/server/services/gwlRaid";

const now = Date.parse("2030-01-01T00:00:00Z");
const fixture: GwlFixture = {
  number: "2901", status: "scheduled", startsAt: "2030-01-21T19:30:00Z", map: "north-america", layer: "Houses", region: "EU",
  sides: [
    { team: { slug: "pmf", name: "PMF", tag: "PMF" }, faction: "Lonestar", points: null, score: null, placement: null, eloDelta: null },
    { team: { slug: "remnant", name: "Remnant", tag: "RMNT" }, faction: "Valkyra", points: null, score: null, placement: null, eloDelta: null },
    { team: { slug: "tll", name: "TLL", tag: "TLL" }, faction: "Manticore", points: null, score: null, placement: null, eloDelta: null },
  ],
};
const names = { role: "Member", voice: "Briefing", roleNames: [] };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.lock.mockImplementation(async (fn: () => Promise<void>) => fn());
  mocks.names.mockResolvedValue(names);
  mocks.posted.mockResolvedValue([]);
  mocks.scheduled.mockResolvedValue([]);
  mocks.audit.mockResolvedValue(undefined);
  mocks.fixtures.mockResolvedValue({ stale: false, data: { upcoming: [fixture], recent: [] } });
});

describe("GWL Raid Helper payload", () => {
  it("uses GWL branding, all factions and the correct briefing and post times", () => {
    const body = gwlEventBody(fixture, names, now / 1000);
    const match = Date.parse(fixture.startsAt) / 1000;
    expect(body.title).toBe("GWL | RMNT v PMF v TLL");
    expect(Number(body.date)).toBe(match - 1800);
    expect(body.schedule).toBe(match - 12 * 86400);
    expect(body.description).toContain("**Map:** Zestafona");
    expect(body.description).toContain("**Layer:** Houses");
    expect(body.description).toContain("<:lonestar:1564588882551636058> PMF");
    expect(body.description).toContain("<:manticore:1564588916110270504> TLL");
    expect(body.description).toContain("<:valkyra:1564588959542157382> RMNT");
    expect(body.advancedSettings.image).toBe("https://dashboard.test/images/gwl.png");
  });

  it("refuses ambiguous teams and role collisions", () => {
    expect(() => gwlEventBody({ ...fixture, sides: fixture.sides.slice(0, 1) }, names, now / 1000)).toThrow("one RMNT");
    expect(() => gwlEventBody(fixture, { ...names, roleNames: ["gwl | rmnt v pmf v tll"] }, now / 1000)).toThrow("already reserved");
  });

  it("posts immediately when the twelve-day window has passed and rejects a late briefing", () => {
    const match = Date.parse(fixture.startsAt) / 1000;
    expect(gwlEventBody(fixture, names, match - 12 * 86400 - 1).schedule).toBe(match - 12 * 86400);
    expect(gwlEventBody(fixture, names, match - 12 * 86400).schedule).toBeUndefined();
    expect(gwlEventBody(fixture, names, match - 11 * 86400).schedule).toBeUndefined();
    expect(() => gwlEventBody(fixture, names, match - 1800)).toThrow("Briefing has already started");
  });
});

describe("GWL event automation", () => {
  function database() {
    const row: { match_number: string; fixture: GwlFixture; state: string; scheduled_id: string | null; event_id: string | null;
      start_time: number | null; post_at: number | null; temporary_role: string | null; member_role_name: string | null;
      voice_channel_name: string | null; error: string | null } = { match_number: fixture.number, fixture, state: "pending", scheduled_id: null, event_id: null,
      start_time: null, post_at: null, temporary_role: null, member_role_name: null, voice_channel_name: null, error: null };
    mocks.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql === "SELECT * FROM gwl_raid_events") return [row];
      if (sql.includes("WHERE state = 'pending' ORDER BY")) return row.state === "pending" ? [row] : [];
      if (sql.includes("SELECT temporary_role FROM")) return [];
      if (sql.includes("SET state = 'creating'")) { row.state = "creating"; return [{ match_number: fixture.number }]; }
      if (sql.includes("SET scheduled_id = $2")) { row.scheduled_id = values[1] as string | null; row.event_id = values[2] as string | null; return [{ match_number: fixture.number }]; }
      if (sql.includes("SET state = $2, updated_at")) { row.state = values[1] as string; return []; }
      if (sql.includes("SET state = 'uncertain', error = $2")) { row.state = "uncertain"; return []; }
      if (sql.includes("SET state = 'review', error = $2")) { row.state = "review"; return []; }
      return [];
    });
    return row;
  }

  it("creates and records a scheduled event", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const row = database();
      mocks.create.mockResolvedValue({ event: { id: "schedule1" } });
      await gwlFixtureTick();
      expect(mocks.lock).toHaveBeenCalledWith(expect.any(Function), true);
      expect(row.state).toBe("scheduled");
      expect(row.scheduled_id).toBe("schedule1");
      expect(mocks.create).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it("treats PostgreSQL-reordered team fields as unchanged", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const row = database();
      row.fixture = {
        ...fixture,
        sides: fixture.sides.map((side) => ({
          ...side, team: { tag: side.team.tag, name: side.team.name, slug: side.team.slug },
        })),
      };
      mocks.create.mockResolvedValue({ event: { id: "schedule1" } });
      await gwlFixtureTick();
      expect(row.state).toBe("scheduled");
      expect(mocks.create).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it("marks an uncertain write and never retries it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const row = database();
      mocks.create.mockRejectedValue(new Error("timeout"));
      await expect(gwlFixtureTick()).rejects.toThrow("could not be confirmed");
      expect(row.state).toBe("uncertain");
      await gwlFixtureTick();
      expect(mocks.create).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it("stops when an existing event matches the briefing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const row = database();
      mocks.scheduled.mockResolvedValue([{ id: "other", title: "Existing", channelId: "1546479425644793877",
        startTime: Date.parse(fixture.startsAt) / 1000 - 1800 }]);
      await gwlFixtureTick();
      expect(row.state).toBe("review");
      expect(mocks.create).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("does not create from stale fixture data", async () => {
    database();
    mocks.fixtures.mockResolvedValue({ stale: true, error: "GWL unavailable" });
    await expect(gwlFixtureTick()).rejects.toThrow("GWL unavailable");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refuses a fixture that changes during preflight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const row = database();
      mocks.fixtures.mockResolvedValueOnce({ stale: false, data: { upcoming: [fixture], recent: [] } });
      mocks.fixtures.mockResolvedValueOnce({ stale: false, data: { upcoming: [{ ...fixture, layer: "changed" }], recent: [] } });
      await gwlFixtureTick();
      expect(row.state).toBe("review");
      expect(mocks.create).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
