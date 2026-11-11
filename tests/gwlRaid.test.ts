import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GwlFixture } from "@/server/services/gwl";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), fixtures: vi.fn(), names: vi.fn(), posted: vi.fn(), scheduled: vi.fn(),
  create: vi.fn(), raw: vi.fn(), audit: vi.fn(), lock: vi.fn(), channel: vi.fn(), update: vi.fn(),
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
    getScheduledWdlEvents: mocks.scheduled, createGwlRaidEvent: mocks.create, getRawWdlEvent: mocks.raw, isWdlEventChannel: mocks.channel,
    updateWdlEventDescription: mocks.update };
});

import { gwlEventBody, updatedGwlWeatherDescription } from "@/server/services/gwlRaidHelper";
import { gwlFixtureTick } from "@/server/services/gwlRaid";

const now = Date.parse("2030-01-01T00:00:00Z");
const fixture: GwlFixture = {
  number: "2901", status: "scheduled", startsAt: "2030-01-21T19:30:00Z", map: "north-america", layer: "Houses", weather: "clear", region: "EU",
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
  mocks.channel.mockResolvedValue(true);
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
    expect(body.description).toContain("**Zone:** Houses");
    expect(body.description).toContain("**Weather:** Clear");
    expect(body.description).toContain("<:lonestar:1564588882551636058> PMF");
    expect(body.description).toContain("<:manticore:1564588916110270504> TLL");
    expect(body.description).toContain("<:valkyra:1564588959542157382> RMNT");
    expect(body.advancedSettings.image).toBe("https://dashboard.test/images/gwl.png");
  });

  it("preserves staff notes when updating old descriptions and detects unsafe edits", () => {
    const old = "**Map:** Zestafona\n**Layer:** Houses\n\nStaff note";
    expect(updatedGwlWeatherDescription(old, fixture, fixture)).toBe("**Map:** Zestafona\n**Zone:** Houses\n**Weather:** Clear\n\nStaff note");
    expect(() => updatedGwlWeatherDescription("**Layer:** Other", fixture, fixture)).toThrow("zone was edited");
    expect(() => updatedGwlWeatherDescription("**Layer:** Houses\n**Weather:** Staff choice", fixture, fixture)).toThrow("weather was edited");
    expect(() => updatedGwlWeatherDescription("**Zone:** Houses\n**Layer:** Houses", fixture, fixture)).toThrow("identified safely");
    expect(() => updatedGwlWeatherDescription("**Layer:** Houses\n **weather:** Rain", fixture, fixture)).toThrow("formatting was edited");
    expect(updatedGwlWeatherDescription("**Zone:** Houses\n**Weather:** Clear", fixture, { ...fixture, weather: "rain" }))
      .toBe("**Zone:** Houses\n**Weather:** Rain");
    expect(updatedGwlWeatherDescription("**Layer:** Houses", fixture, { ...fixture, weather: null }))
      .toBe("**Zone:** Houses\n**Weather:** Any");
  });

  it("refuses ambiguous teams and role collisions", () => {
    expect(() => gwlEventBody({ ...fixture, sides: fixture.sides.slice(0, 1) }, names, now / 1000)).toThrow("one RMNT");
    expect(() => gwlEventBody(fixture, { ...names, roleNames: ["gwl | rmnt v pmf v tll"] }, now / 1000)).toThrow("already reserved");
  });

  describe("GWL posted event weather updates", () => {
    const saved = { ...fixture, weather: undefined };
    const old = "**Map:** Zestafona\n**Layer:** Houses\n\nStaff note";
    const updated = "**Map:** Zestafona\n**Zone:** Houses\n**Weather:** Clear\n\nStaff note";
    const row = () => ({ match_number: fixture.number, fixture: saved, state: "posted", event_id: "event1",
      event_channel_id: "thread1", temporary_role: "GWL | RMNT v PMF v TLL", scheduled_id: null });
    const event = () => ({ id: "event1", serverId: "1332320879073296404", channelId: "thread1",
      title: "GWL | RMNT v PMF v TLL", templateId: "ct34", startTime: Date.parse(fixture.startsAt) / 1000 - 1800,
      description: old, signUps: [{ id: 1, userId: "player1" }] });

    function setup() {
      const record = row();
      mocks.query.mockImplementation(async (sql: string) => {
        if (sql === "SELECT * FROM gwl_raid_events") return [record];
        if (sql.includes("SET state = 'uncertain', error = 'Description update")) { record.state = "uncertain"; return [{ match_number: fixture.number }]; }
        if (sql.includes("SET state = 'posted', fixture = $3")) { record.state = "posted"; return [{ match_number: fixture.number }]; }
        if (sql.includes("SET state = 'review', error = $2")) { record.state = "review"; return []; }
        return [];
      });
      mocks.raw.mockResolvedValue(event());
      return record;
    }

    it("updates a verified posted event and checks signups after readback", async () => {
      vi.useFakeTimers(); vi.setSystemTime(now);
      try {
        const record = setup();
        mocks.update.mockResolvedValue(undefined);
        mocks.raw.mockResolvedValueOnce(event()).mockResolvedValueOnce(event()).mockResolvedValueOnce({ ...event(), description: updated });
        await gwlFixtureTick();
        expect(mocks.update).toHaveBeenCalledWith("event1", updated);
        expect(record.state).toBe("posted");
      } finally { vi.useRealTimers(); }
    });

    it("keeps uncertain state after an unverified write and never retries", async () => {
      vi.useFakeTimers(); vi.setSystemTime(now);
      try {
        const record = setup();
        mocks.update.mockRejectedValue(new Error("timeout"));
        await expect(gwlFixtureTick()).rejects.toThrow("could not be confirmed");
        expect(record.state).toBe("uncertain");
        await gwlFixtureTick();
        expect(mocks.update).toHaveBeenCalledOnce();
      } finally { vi.useRealTimers(); }
    });

    it("flags unexpected staff changes instead of overwriting them", async () => {
      vi.useFakeTimers(); vi.setSystemTime(now);
      try {
        const record = setup();
        mocks.raw.mockResolvedValue({ ...event(), description: "**Layer:** Staff override" });
        await gwlFixtureTick();
        expect(record.state).toBe("review");
        expect(mocks.update).not.toHaveBeenCalled();
      } finally { vi.useRealTimers(); }
    });

    it("does not claim success if existing signups disappear", async () => {
      vi.useFakeTimers(); vi.setSystemTime(now);
      try {
        const record = setup();
        mocks.update.mockResolvedValue(undefined);
        mocks.raw.mockResolvedValueOnce(event()).mockResolvedValueOnce(event()).mockResolvedValueOnce({ ...event(), description: updated, signUps: [] });
        await expect(gwlFixtureTick()).rejects.toThrow("signups could not be verified");
        expect(record.state).toBe("uncertain");
      } finally { vi.useRealTimers(); }
    });

    it("does not write if the fixture changes during preflight", async () => {
      vi.useFakeTimers(); vi.setSystemTime(now);
      try {
        const record = setup();
        mocks.fixtures.mockResolvedValueOnce({ stale: false, data: { upcoming: [fixture], recent: [] } })
          .mockResolvedValueOnce({ stale: false, data: { upcoming: [{ ...fixture, weather: "rain" }], recent: [] } });
        await gwlFixtureTick();
        expect(record.state).toBe("review");
        expect(mocks.update).not.toHaveBeenCalled();
      } finally { vi.useRealTimers(); }
    });

    it("does not write from a stale fixture or overwrite a concurrent description edit", async () => {
      vi.useFakeTimers(); vi.setSystemTime(now);
      try {
        const record = setup();
        mocks.fixtures.mockResolvedValueOnce({ stale: false, data: { upcoming: [fixture], recent: [] } })
          .mockResolvedValueOnce({ stale: true, error: "GWL unavailable" });
        await expect(gwlFixtureTick()).rejects.toThrow("GWL unavailable");
        expect(record.state).toBe("posted");
        expect(mocks.update).not.toHaveBeenCalled();
        mocks.fixtures.mockResolvedValue({ stale: false, data: { upcoming: [fixture], recent: [] } });
        mocks.raw.mockResolvedValueOnce(event()).mockResolvedValueOnce({ ...event(), description: `${old}\nNew note` });
        await gwlFixtureTick();
        expect(record.state).toBe("review");
        expect(mocks.update).not.toHaveBeenCalled();
      } finally { vi.useRealTimers(); }
    });

    it("rejects an incorrect forum and missing signup data", async () => {
      vi.useFakeTimers(); vi.setSystemTime(now);
      try {
        const record = setup();
        mocks.channel.mockResolvedValue(false);
        await gwlFixtureTick();
        expect(record.state).toBe("review");
        expect(mocks.update).not.toHaveBeenCalled();
        record.state = "posted";
        mocks.channel.mockResolvedValue(true);
        mocks.raw.mockResolvedValue({ ...event(), signUps: undefined });
        await gwlFixtureTick();
        expect(record.state).toBe("review");
        expect(mocks.update).not.toHaveBeenCalled();
      } finally { vi.useRealTimers(); }
    });

    it("does not update a scheduled event using the posted-event endpoint", async () => {
      vi.useFakeTimers(); vi.setSystemTime(now);
      try {
        const record = setup();
        record.state = "scheduled";
        await gwlFixtureTick();
        expect(mocks.update).not.toHaveBeenCalled();
      } finally { vi.useRealTimers(); }
    });
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
      mocks.create.mockImplementation(async (_channel, body) => {
        mocks.scheduled.mockResolvedValue([{ id: "schedule1", channelId: "1546479425644793877",
          title: body.title, startTime: Number(body.date), postTime: body.schedule }]);
        return { status: "unrecognized", event: { id: "schedule1" } };
      });
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
      mocks.create.mockImplementation(async (_channel, body) => {
        mocks.scheduled.mockResolvedValue([{ id: "schedule1", channelId: "1546479425644793877",
          title: body.title, startTime: Number(body.date), postTime: body.schedule }]);
        return { status: "unrecognized", event: { id: "schedule1" } };
      });
      await gwlFixtureTick();
      expect(row.state).toBe("scheduled");
      expect(mocks.create).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it("verifies and records an immediate forum event despite an unfamiliar response status", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(fixture.startsAt) - 86400_000);
    try {
      const row = database();
      mocks.create.mockResolvedValue({ status: "unrecognized", event: { id: "1569727003605864530" } });
      mocks.raw.mockResolvedValue({ id: "1569727003605864530", serverId: "1332320879073296404",
        channelId: "1569727003605864530", templateId: "ct34",
        title: "GWL | RMNT v PMF v TLL", startTime: Date.parse(fixture.startsAt) / 1000 - 1800 });
      await gwlFixtureTick();
      expect(mocks.channel).toHaveBeenCalledWith("1569727003605864530");
      expect(row.state).toBe("posted");
      expect(row.event_id).toBe("1569727003605864530");
    } finally { vi.useRealTimers(); }
  });

  it("does not mark an event posted if the forum thread belongs elsewhere", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(fixture.startsAt) - 86400_000);
    try {
      const row = database();
      mocks.create.mockResolvedValue({ status: "unrecognized", event: { id: "1569727003605864530" } });
      mocks.raw.mockResolvedValue({ id: "1569727003605864530", serverId: "1332320879073296404",
        channelId: "1569727003605864530", templateId: "ct34",
        title: "GWL | RMNT v PMF v TLL", startTime: Date.parse(fixture.startsAt) / 1000 - 1800 });
      mocks.channel.mockResolvedValue(false);
      await expect(gwlFixtureTick()).rejects.toThrow("could not be confirmed");
      expect(row.state).toBe("uncertain");
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
