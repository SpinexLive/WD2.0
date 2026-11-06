import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: null as import("pg").Client | null, publish: vi.fn() }));
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
vi.mock("@/server/services/bus", () => ({ publish: mocks.publish }));

import { getRoster, saveRoster, saveSchema } from "@/server/services/rosters";

const playerId = "100000000000000001";

describe.skipIf(!process.env.TEST_DATABASE_URL)("saved squad comparison with PostgreSQL", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await mocks.client.connect();
    await mocks.client.query(`
      CREATE TEMP TABLE roster_templates (id serial PRIMARY KEY, key text, name text, event_type text, definition jsonb);
      CREATE TEMP TABLE rosters (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), raid_helper_event_id text NOT NULL,
        event_type text NOT NULL, template_id int, settings jsonb NOT NULL,
        status text NOT NULL, version int NOT NULL, last_editor_id text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TEMP TABLE roster_squads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), roster_id uuid NOT NULL REFERENCES rosters(id),
        position int NOT NULL, name text NOT NULL, category text NOT NULL, size int NOT NULL, leader_required boolean NOT NULL
      );
      CREATE TEMP TABLE roster_assignments (
        roster_id uuid NOT NULL REFERENCES rosters(id), squad_id uuid NOT NULL REFERENCES roster_squads(id) ON DELETE CASCADE,
        slot_index int NOT NULL, discord_id text, display_name text NOT NULL, avatar_url text,
        is_leader boolean NOT NULL, mercenary_id uuid, tokens text[] NOT NULL DEFAULT '{}'
      );
      CREATE TEMP TABLE published_messages (
        roster_id uuid, part_index int, channel_id text, message_id text, published_at timestamptz, updated_at timestamptz
      );
      CREATE TEMP TABLE roster_responses (roster_id uuid, discord_id text, response text);
      CREATE TEMP TABLE loadout_unlocks (discord_id text, item_key text);
    `);
    await mocks.client.query(`
      INSERT INTO rosters (raid_helper_event_id, event_type, settings, status, version, last_editor_id, updated_at)
      VALUES ('event1', 'weekly', '{"warnUnregistered":true}', 'draft', 1, 'editor', '2025-01-01T00:00:00Z');
      INSERT INTO roster_squads (roster_id, position, name, category, size, leader_required)
      SELECT id, 0, 'Alpha', 'INFANTRY', 2, false FROM rosters;
    `);
    await mocks.client.query(await readFile(resolve(process.cwd(), "migrations", "033_roster_squad_comparison.sql"), "utf8"));
    await mocks.client.query(`
      INSERT INTO roster_assignments (roster_id, squad_id, slot_index, discord_id, display_name, is_leader)
      SELECT roster_id, id, 0, $1, 'Player', false FROM roster_squads;
    `, [playerId]);
  });

  afterEach(async () => {
    await mocks.client?.end();
    mocks.client = null;
  });

  it("defaults existing squads off and preserves the toggle, players and slots through save and reload", async () => {
    const before = (await getRoster("event1"))!;
    expect(before.squads[0]).toMatchObject({ compareKd: false, size: 2 });
    expect(before.contentUpdatedAt).toBe(before.updatedAt);
    expect(before.squads[0]!.slots[0]!.discordId).toBe(playerId);

    const input = saveSchema.parse({
      version: before.version, settings: before.settings,
      squads: before.squads.map((squad) => ({ ...squad, compareKd: true })),
    });
    const saved = await saveRoster("event1", input, "editor");
    expect(saved.squads[0]).toMatchObject({ compareKd: true, name: "Alpha", size: 2 });
    expect(saved.contentUpdatedAt).toBe(before.contentUpdatedAt);
    expect(saved.squads[0]!.slots.map((p) => p?.discordId ?? null)).toEqual([playerId, null]);
    expect((await getRoster("event1"))!.squads[0]!.compareKd).toBe(true);

    const changed = await saveRoster("event1", saveSchema.parse({
      version: saved.version, settings: saved.settings,
      squads: saved.squads.map((squad) => ({ ...squad, compareKd: false })),
    }), "editor");
    expect(changed.squads[0]!.compareKd).toBe(false);
    expect(mocks.publish).toHaveBeenCalledWith("roster", { eventId: "event1" });
  });

  it("preserves selection if an older client saves without the new field", async () => {
    await mocks.client!.query("UPDATE roster_squads SET compare_kd = true");
    const before = (await getRoster("event1"))!;
    const oldSquads = before.squads.map(({ compareKd: _compareKd, ...squad }) => squad);
    const result = await saveRoster("event1", saveSchema.parse({ version: before.version, settings: before.settings, squads: oldSquads }), "editor");
    expect(result.squads[0]!.compareKd).toBe(true);
  });

  it("rejects stale versions without changing comparison selections", async () => {
    const before = (await getRoster("event1"))!;
    await expect(saveRoster("event1", saveSchema.parse({
      version: before.version + 1, settings: before.settings,
      squads: before.squads.map((squad) => ({ ...squad, compareKd: true })),
    }), "editor")).rejects.toMatchObject({ status: 409, code: "conflict" });
    expect((await getRoster("event1"))!.squads[0]!.compareKd).toBe(false);
  });

  it("still marks real roster content changes for Discord publishing", async () => {
    const before = (await getRoster("event1"))!;
    const changed = await saveRoster("event1", saveSchema.parse({
      version: before.version, settings: before.settings,
      squads: before.squads.map((squad) => ({ ...squad, name: "Renamed", compareKd: true })),
    }), "editor");
    expect(Date.parse(changed.contentUpdatedAt!)).toBeGreaterThan(Date.parse(before.contentUpdatedAt!));
  });

  it("preserves confirmed and declined responses through a squad rename and later saves", async () => {
    const secondPlayer = "100000000000000002";
    await mocks.client!.query(`
      INSERT INTO roster_assignments (roster_id, squad_id, slot_index, discord_id, display_name, is_leader)
      SELECT roster_id, id, 1, $1, 'Second player', false FROM roster_squads`, [secondPlayer]);
    await mocks.client!.query(`
      INSERT INTO roster_responses (roster_id, discord_id, response)
      SELECT id, $1, 'confirmed' FROM rosters UNION ALL
      SELECT id, $2, 'declined' FROM rosters`, [playerId, secondPlayer]);
    const before = (await getRoster("event1"))!;
    const renamed = await saveRoster("event1", saveSchema.parse({
      version: before.version, settings: before.settings,
      squads: before.squads.map((squad) => ({ ...squad, name: "Bravo", category: "BRAVO" })),
    }), "editor");
    expect(renamed.responses).toEqual({ [playerId]: "confirmed", [secondPlayer]: "declined" });
    expect(Date.parse(renamed.contentUpdatedAt!)).toBeGreaterThan(Date.parse(before.contentUpdatedAt!));
    const savedAgain = await saveRoster("event1", saveSchema.parse({
      version: renamed.version, settings: renamed.settings, squads: renamed.squads,
    }), "editor");
    expect(savedAgain.responses).toEqual({ [playerId]: "confirmed", [secondPlayer]: "declined" });
  });

  it("clears confirmations for moves to a different squad even when names match", async () => {
    await mocks.client!.query(`
      INSERT INTO roster_squads (roster_id, position, name, category, size, leader_required)
      SELECT id, 1, 'Alpha', 'INFANTRY', 2, false FROM rosters`);
    await mocks.client!.query("INSERT INTO roster_responses (roster_id, discord_id, response) SELECT id, $1, 'confirmed' FROM rosters", [playerId]);
    const before = (await getRoster("event1"))!;
    const player = before.squads[0]!.slots[0]!;
    const moved = before.squads.map((squad, index) => ({
      ...squad, slots: index === 0 ? [null, null] : [player, null],
    }));
    const saved = await saveRoster("event1", saveSchema.parse({ version: before.version, settings: before.settings, squads: moved }), "editor");
    expect(saved.responses).toEqual({});
    expect(saved.squads[1]!.slots[0]!.discordId).toBe(playerId);
  });

  it("clears a response when a player moves into a newly created squad", async () => {
    await mocks.client!.query("INSERT INTO roster_responses (roster_id, discord_id, response) SELECT id, $1, 'declined' FROM rosters", [playerId]);
    const before = (await getRoster("event1"))!;
    const squad = before.squads[0]!;
    const saved = await saveRoster("event1", saveSchema.parse({
      version: before.version, settings: before.settings,
      squads: [
        { ...squad, slots: [null, null] },
        { ...squad, id: "new-squad", name: "Bravo" },
      ],
    }), "editor");
    expect(saved.responses).toEqual({});
    expect(saved.squads[1]!.slots[0]!.discordId).toBe(playerId);
  });

  it("keeps a confirmation when moving within a squad and clears it when removed", async () => {
    await mocks.client!.query("INSERT INTO roster_responses (roster_id, discord_id, response) SELECT id, $1, 'confirmed' FROM rosters", [playerId]);
    const before = (await getRoster("event1"))!;
    const player = before.squads[0]!.slots[0]!;
    const moved = await saveRoster("event1", saveSchema.parse({
      version: before.version, settings: before.settings,
      squads: before.squads.map((squad) => ({ ...squad, slots: [null, player] })),
    }), "editor");
    expect(moved.responses).toEqual({ [playerId]: "confirmed" });
    const removed = await saveRoster("event1", saveSchema.parse({
      version: moved.version, settings: moved.settings,
      squads: moved.squads.map((squad) => ({ ...squad, slots: [null, null] })),
    }), "editor");
    expect(removed.responses).toEqual({});
    expect((await mocks.client!.query("SELECT count(*)::int AS n FROM roster_responses")).rows[0].n).toBe(0);
  });

  it("rejects duplicated squad IDs rather than mistaking a move for a rename", async () => {
    const before = (await getRoster("event1"))!;
    const squad = before.squads[0]!;
    await expect(saveRoster("event1", saveSchema.parse({
      version: before.version, settings: before.settings,
      squads: [squad, { ...squad, name: "Other", slots: [null, null] }],
    }), "editor")).rejects.toMatchObject({ status: 400, code: "invalid_roster" });
    expect((await getRoster("event1"))!.version).toBe(before.version);
  });
});
