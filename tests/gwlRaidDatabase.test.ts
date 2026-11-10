import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GwlFixture } from "@/server/services/gwl";

const mocks = vi.hoisted(() => ({
  client: null as pg.Client | null, fixtures: vi.fn(), names: vi.fn(), posted: vi.fn(), scheduled: vi.fn(),
  create: vi.fn(), raw: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ env: () => ({ APP_URL: "https://dashboard.test", DISCORD_GUILD_ID: "1332320879073296404" }) }));
vi.mock("@/lib/db", () => ({
  query: async (sql: string, values: unknown[] = []) => (await mocks.client!.query(sql, values)).rows,
  independentQuery: async (sql: string, values: unknown[] = []) => (await mocks.client!.query(sql, values)).rows,
  withLeagueEventLock: async (fn: () => Promise<void>) => fn(),
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/server/services/gwl", () => ({ getGwlFixtures: mocks.fixtures }));
vi.mock("@/server/services/wdlRaidHelper", async (original) => {
  const actual = await original<typeof import("@/server/services/wdlRaidHelper")>();
  return { ...actual, wdlEventNames: mocks.names, getPostedWdlEvents: mocks.posted,
    getScheduledWdlEvents: mocks.scheduled, createWdlRaidEvent: mocks.create, getRawWdlEvent: mocks.raw };
});

import { gwlFixtureTick } from "@/server/services/gwlRaid";

const makeFixture = (): GwlFixture => ({
  number: "2901", status: "scheduled", startsAt: new Date(Date.now() + 20 * 86400_000).toISOString(),
  map: "north-america", layer: "Houses", region: "EU",
  sides: ["RMNT", "PMF", "TLL"].map((tag) => ({
    team: { slug: tag.toLowerCase(), name: tag, tag }, faction: null, points: null, score: null, placement: null, eloDelta: null,
  })),
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("GWL Raid Helper PostgreSQL integration", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await mocks.client.connect();
    for (const migration of ["034_wdl_fixtures.sql", "045_gwl_raid_events.sql"]) {
      const sql = await readFile(resolve(process.cwd(), "migrations", migration), "utf8");
      await mocks.client.query(sql.replace(/CREATE TABLE/g, "CREATE TEMP TABLE"));
    }
    mocks.names.mockResolvedValue({ role: "Member", voice: "Briefing", roleNames: [] });
    mocks.posted.mockResolvedValue([]);
    mocks.scheduled.mockResolvedValue([]);
    mocks.create.mockResolvedValue({ status: "success", event: { id: "schedule1" } });
    mocks.audit.mockResolvedValue(undefined);
  });
  afterEach(async () => { await mocks.client?.end(); mocks.client = null; });

  it("persists one scheduled event and does not create it again", async () => {
    const fixture = makeFixture();
    mocks.fixtures.mockResolvedValue({ stale: false, data: { upcoming: [fixture], recent: [] } });
    await gwlFixtureTick();
    await gwlFixtureTick();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect((await mocks.client!.query("SELECT state, scheduled_id FROM gwl_raid_events")).rows[0])
      .toEqual({ state: "scheduled", scheduled_id: "schedule1" });
  });

  it("prevents a GWL write when WDL has reserved the briefing time", async () => {
    const fixture = makeFixture();
    mocks.fixtures.mockResolvedValue({ stale: false, data: { upcoming: [fixture], recent: [] } });
    await mocks.client!.query(
      "INSERT INTO wdl_fixture_events (fixture_id, fixture, state, start_time) VALUES ('wdl', '{}', 'scheduled', $1)",
      [Math.floor(Date.parse(fixture.startsAt) / 1000) - 1800],
    );
    await gwlFixtureTick();
    expect(mocks.create).not.toHaveBeenCalled();
    expect((await mocks.client!.query("SELECT state FROM gwl_raid_events")).rows[0].state).toBe("review");
  });
});
