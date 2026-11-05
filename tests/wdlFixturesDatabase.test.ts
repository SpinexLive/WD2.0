import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: null as import("pg").Client | null, fixtures: vi.fn() }));
vi.mock("@/lib/db", () => ({
  query: async (sql: string, values: unknown[] = []) => {
    if (!mocks.client) throw new Error("Test database is not connected");
    return (await mocks.client.query(sql, values)).rows;
  },
}));
vi.mock("@/server/services/wardogsLeague", () => ({ getLeagueFixtures: mocks.fixtures }));

import { fixtureOverview } from "@/server/services/wdlFixtures";
import type { WdlFixture } from "@/lib/wdlFixtures";

const result: WdlFixture = {
  id: "fixture-1", number: 1, status: "COMPLETED", scheduledAt: "2026-01-01T19:00:00Z",
  map: null, gameMode: null, competition: null,
  participants: [
    { team: { code: "RMNT", name: "Remnant" }, faction: null, finishingPosition: 1, points: 10, noShow: false },
    { team: { code: "WTH", name: "WTH" }, faction: null, finishingPosition: 2, points: 0, noShow: false },
  ],
};
const snapshot = (recent: WdlFixture[], stale = false) => ({ data: { upcoming: [], recent }, stale, fetchedAt: "2026-01-01T00:00:00Z" });

describe.skipIf(!process.env.TEST_DATABASE_URL)("WDL fixture archive with PostgreSQL", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await mocks.client.connect();
    const migration = await readFile(resolve(process.cwd(), "migrations", "034_wdl_fixtures.sql"), "utf8");
    await mocks.client.query(migration.replace(/CREATE TABLE/g, "CREATE TEMP TABLE"));
  });
  afterEach(async () => { await mocks.client?.end(); mocks.client = null; });

  it("keeps earlier results after they leave the WDL recent response", async () => {
    mocks.fixtures.mockResolvedValueOnce(snapshot([result])).mockResolvedValueOnce(snapshot([]));
    expect((await fixtureOverview()).recent).toEqual([result]);
    expect((await fixtureOverview()).recent).toEqual([result]);
    expect((await mocks.client!.query("SELECT count(*)::int AS n FROM wdl_fixture_archive")).rows[0].n).toBe(1);
  });

  it("shows archived results with an explicit outage instead of an empty upcoming list", async () => {
    mocks.fixtures.mockResolvedValueOnce(snapshot([result])).mockRejectedValueOnce(new Error("WDL unavailable"));
    await fixtureOverview();
    const offline = await fixtureOverview();
    expect(offline.upcoming).toBeNull();
    expect(offline.recent).toEqual([result]);
    expect(offline.source).toMatchObject({ available: false, error: "WDL unavailable" });
  });

  it("does not overwrite a newer archived result with a stale API snapshot", async () => {
    mocks.fixtures.mockResolvedValueOnce(snapshot([result])).mockResolvedValueOnce(snapshot([{ ...result, map: "Old map" }], true));
    await fixtureOverview();
    const stale = await fixtureOverview();
    expect(stale.recent[0]!.map).toBeNull();
    expect(stale.source.stale).toBe(true);
  });

  it("preserves but hides a corrected result while it is upcoming, including during an outage", async () => {
    const rescheduled = { ...result, status: "SCHEDULED", scheduledAt: "2026-02-01T19:00:00Z" };
    mocks.fixtures.mockResolvedValueOnce(snapshot([result]))
      .mockResolvedValueOnce({ ...snapshot([]), data: { upcoming: [rescheduled], recent: [] } })
      .mockRejectedValueOnce(new Error("WDL unavailable"))
      .mockResolvedValueOnce(snapshot([result], true))
      .mockResolvedValueOnce(snapshot([result]));
    await fixtureOverview();
    const current = await fixtureOverview();
    expect(current.upcoming).toEqual([rescheduled]);
    expect(current.recent).toEqual([]);
    expect((await mocks.client!.query("SELECT fixture, is_result FROM wdl_fixture_archive")).rows[0])
      .toMatchObject({ fixture: rescheduled, is_result: false });
    expect((await fixtureOverview()).recent).toEqual([]);
    expect((await fixtureOverview()).recent).toEqual([]);
    expect((await fixtureOverview()).recent).toEqual([result]);
  });

  it("does not show an archived result again as an upcoming fixture from a stale snapshot", async () => {
    const oldUpcoming = { ...result, status: "SCHEDULED" };
    mocks.fixtures.mockResolvedValueOnce(snapshot([result]))
      .mockResolvedValueOnce({ ...snapshot([], true), data: { upcoming: [oldUpcoming], recent: [] } });
    await fixtureOverview();
    const stale = await fixtureOverview();
    expect(stale.upcoming).toEqual([]);
    expect(stale.recent).toEqual([result]);
  });
});
