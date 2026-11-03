import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: null as import("pg").Client | null }));
vi.mock("@/lib/db", () => ({
  query: async (sql: string, values: unknown[] = []) => {
    if (!mocks.client) throw new Error("Test database is not connected");
    return (await mocks.client.query(sql, values)).rows;
  },
}));
vi.mock("@/server/services/discord", () => ({
  getClanMembers: async () => ({ data: [{ id: "clan" }], stale: false }),
  getAllClanMembers: async () => ({ data: [{ id: "clan" }], stale: false }),
}));
vi.mock("@/server/services/links", () => ({
  resolveLinks: async () => ({
    steamIds: new Map([["clan", "76561198000000002"]]),
    source: { available: true, stale: false },
  }),
}));

import { buildRecruitReport, recruitPlayerStats } from "@/server/services/recruit";

const recruitId = "76561198000000001";
const clanId = "76561198000000002";

describe.skipIf(!process.env.TEST_DATABASE_URL)("stored recruit statistics with PostgreSQL", () => {
  beforeEach(async () => {
    mocks.client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await mocks.client.connect();
    await mocks.client.query(`
      CREATE TEMP TABLE matches (id bigint PRIMARY KEY, ended_at timestamptz, peak_players int, mvp_steam_id text);
      CREATE TEMP TABLE match_players (match_id bigint, steam_id text, name text, faction text, kills int, deaths int, cash bigint);
      CREATE TEMP TABLE recruit_status (steam_id text, status text, note text, updated_by_name text, updated_at timestamptz);
      INSERT INTO matches (id, ended_at, peak_players) VALUES
        (1, now(), 80), (2, now(), 100), (3, now(), 100), (4, now(), 79), (5, now(), 100), (6, now(), 100);
    `);
    await mocks.client.query(`
      INSERT INTO match_players (match_id, steam_id, name, faction, kills, deaths, cash) VALUES
        (1, $1, 'Recruit', 'Lonestar', 3, 1, 100),
        (2, $1, 'Recruit', 'Lonestar', 2, 1, 200),
        (3, $1, 'Recruit', 'White', 100, 1, 1000),
        (4, $1, 'Recruit', 'Lonestar', 100, 1, 1000),
        (5, $1, 'Recruit', 'Lonestar', 0, 0, 1000),
        (1, $2, 'Clan', 'Lonestar', 4, 2, 100),
        (2, $2, 'Clan', 'Lonestar', 4, 2, 100),
        (3, $2, 'Clan', 'Lonestar', 4, 2, 100)
    `, [recruitId, clanId]);
  });

  afterEach(async () => {
    await mocks.client?.end();
    mocks.client = null;
  });

  it("uses the report's filters while allowing a real player with fewer than three matches", async () => {
    const stats = (await recruitPlayerStats([recruitId])).get(recruitId);
    expect(stats).toMatchObject({ matches: 2, kills: 5, deaths: 2, kd: 2.5, avgCash: 150 });
    expect((await buildRecruitReport()).candidates).toEqual([]);

    await mocks.client!.query("INSERT INTO match_players (match_id, steam_id, name, faction, kills, deaths, cash) VALUES (6, $1, 'Recruit', 'Lonestar', 2, 1, 150)", [recruitId]);
    const updated = (await recruitPlayerStats([recruitId])).get(recruitId)!;
    const candidate = (await buildRecruitReport()).candidates.find((item) => item.steamId === recruitId)!;
    expect(updated).toMatchObject({ matches: 3, kills: 7, deaths: 3, avgCash: 150 });
    expect(candidate).toMatchObject({ matches: 3, kd: Math.round(updated.kd * 100) / 100, avgCash: Math.round(updated.avgCash!) });
  });
});
