import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: null as import("pg").Client | null,
  matches: vi.fn(),
  players: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  query: async (sql: string, values: unknown[] = []) => {
    if (!mocks.client) throw new Error("Test database is not connected");
    return (await mocks.client.query(sql, values)).rows;
  },
  tx: async (fn: (client: import("pg").Client) => Promise<unknown>) => {
    const client = mocks.client;
    if (!client) throw new Error("Test database is not connected");
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  },
}));
vi.mock("@/server/services/wardogsRcon", () => ({
  getMatches: mocks.matches,
  getMatchPlayers: mocks.players,
}));

import { kickMatchSync, matchSyncStatus } from "@/server/services/matchHistory";
import { ProviderError } from "@/lib/http";

const testDatabase = process.env.TEST_DATABASE_URL;
const snapshot = (ids: number[]) => ({
  data: ids.map((id) => ({
    id, serverName: "Server", map: "Map", startedAt: "2026-01-01T10:00:00Z",
    endedAt: "2026-01-01T11:00:00Z", durationS: 3600, peakPlayers: 100, mvpSteamId: null,
  })),
  stale: false,
  fetchedAt: "2026-01-01T11:00:00Z",
});
const player = { steamId: "76561198000000001", name: "Player", faction: "Lonestar", kills: 12, deaths: 4, cash: 100 };

async function sync() {
  kickMatchSync(true);
  const deadline = Date.now() + 65_000;
  while (matchSyncStatus().syncing && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  expect(matchSyncStatus().syncing).toBe(false);
}

describe.skipIf(!testDatabase)("match archive with PostgreSQL", () => {
  beforeEach(async () => {
    if (!testDatabase) throw new Error("TEST_DATABASE_URL is required");
    vi.clearAllMocks();
    Reflect.deleteProperty(globalThis, "__matchSync");
    mocks.client = new pg.Client({ connectionString: testDatabase });
    await mocks.client.connect();
    await mocks.client.query(`
      CREATE TEMP TABLE matches (
        id bigint PRIMARY KEY, server_name text, map text, started_at timestamptz, ended_at timestamptz,
        duration_s integer, peak_players integer, mvp_steam_id text, synced_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TEMP TABLE match_players (
        match_id bigint NOT NULL REFERENCES matches(id), steam_id text NOT NULL, name text, faction text,
        kills integer NOT NULL, deaths integer NOT NULL, cash bigint, PRIMARY KEY (match_id, steam_id)
      );
    `);
    const migration = await readFile(resolve(process.cwd(), "migrations", "028_match_sync_queue.sql"), "utf8");
    await mocks.client.query(migration.replace("CREATE TABLE", "CREATE TEMP TABLE"));
    mocks.players.mockResolvedValue([player]);
  });

  afterEach(async () => {
    await mocks.client?.end();
    mocks.client = null;
    Reflect.deleteProperty(globalThis, "__matchSync");
  });

  it("keeps over 100 archived matches and drains a backlog even after it leaves the recent list", async () => {
    const client = mocks.client!;
    await client.query("INSERT INTO matches (id, ended_at) SELECT n, now() FROM generate_series(1, 120) AS n");
    mocks.matches.mockResolvedValueOnce(snapshot(Array.from({ length: 60 }, (_, i) => 121 + i)))
      .mockResolvedValueOnce(snapshot([]));

    await sync();
    expect(matchSyncStatus()).toMatchObject({ pending: 10, failed: false });
    expect((await client.query("SELECT count(*)::int AS n FROM matches")).rows[0].n).toBe(170);
    expect((await client.query("SELECT count(*)::int AS n FROM match_sync_queue")).rows[0].n).toBe(10);

    await sync();
    expect(matchSyncStatus()).toMatchObject({ pending: 0, failed: false, error: null });
    expect((await client.query("SELECT count(*)::int AS n FROM matches")).rows[0].n).toBe(180);
    expect((await client.query("SELECT count(*)::int AS n FROM match_players")).rows[0].n).toBe(60);
    expect((await client.query("SELECT count(*)::int AS n FROM match_sync_queue")).rows[0].n).toBe(0);
  }, 70_000);

  it("persists a failed match and retries it after a restart, even if it is no longer listed", async () => {
    const client = mocks.client!;
    mocks.matches.mockResolvedValueOnce(snapshot([201])).mockResolvedValueOnce(snapshot([]));
    mocks.players.mockRejectedValueOnce(new Error("Match details unavailable")).mockResolvedValueOnce([player]);

    await sync();
    expect(matchSyncStatus()).toMatchObject({ pending: 1, failed: true, error: expect.stringContaining("Match details unavailable") });
    expect((await client.query("SELECT id, attempts, last_error FROM match_sync_queue")).rows[0])
      .toMatchObject({ id: "201", attempts: 1, last_error: "Match details unavailable" });

    Reflect.deleteProperty(globalThis, "__matchSync");
    await client.query("UPDATE match_sync_queue SET next_attempt_at = now()");
    await sync();
    expect(matchSyncStatus()).toMatchObject({ pending: 0, failed: false });
    expect((await client.query("SELECT id FROM matches")).rows[0]).toMatchObject({ id: "201" });
    expect((await client.query("SELECT steam_id FROM match_players")).rows[0]).toMatchObject({ steam_id: player.steamId });
    expect((await client.query("SELECT count(*)::int AS n FROM match_sync_queue")).rows[0].n).toBe(0);
  });

  it("continues archiving the queue when the recent-match endpoint fails and reports the error", async () => {
    const client = mocks.client!;
    await client.query("INSERT INTO match_sync_queue (id, ended_at) VALUES (301, now())");
    mocks.matches.mockRejectedValue(new Error("Recent matches unavailable"));

    await sync();
    expect(matchSyncStatus()).toMatchObject({ pending: 0, failed: true, error: expect.stringContaining("Recent matches unavailable") });
    expect((await client.query("SELECT id FROM matches")).rows[0]).toMatchObject({ id: "301" });
  });

  it("stops and leaves the backlog queued if Wardogs rate-limits the worker", async () => {
    const client = mocks.client!;
    mocks.matches.mockResolvedValue(snapshot([351, 352]));
    mocks.players.mockRejectedValue(new ProviderError("wardogs-rcon", "Rate limited by wardogs-rcon", 429, true));

    await sync();
    expect(mocks.players).toHaveBeenCalledTimes(1);
    expect(matchSyncStatus()).toMatchObject({ pending: 2, failed: true, error: expect.stringContaining("Rate limited") });
    expect((await client.query("SELECT count(*)::int AS n FROM match_sync_queue")).rows[0].n).toBe(2);
  });

  it("rolls back a partial archive write without losing its queued match", async () => {
    const client = mocks.client!;
    mocks.matches.mockResolvedValueOnce(snapshot([401])).mockResolvedValueOnce(snapshot([]));
    mocks.players.mockResolvedValueOnce([{ ...player, kills: null }]).mockResolvedValueOnce([player]);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await sync();
      expect(matchSyncStatus()).toMatchObject({ failed: true });
      expect((await client.query("SELECT count(*)::int AS n FROM matches")).rows[0].n).toBe(0);
      expect((await client.query("SELECT id FROM match_sync_queue")).rows[0]).toMatchObject({ id: "401" });

      await sync();
      expect(matchSyncStatus()).toMatchObject({ pending: 0, failed: false });
      expect((await client.query("SELECT id FROM matches")).rows[0]).toMatchObject({ id: "401" });
    } finally {
      log.mockRestore();
    }
  });
});
