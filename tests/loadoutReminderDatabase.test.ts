import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: null as import("pg").Client | null, members: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/db", () => ({
  query: async (sql: string, values: unknown[] = []) => {
    if (!mocks.client) throw new Error("Test database is not connected");
    return (await mocks.client.query(sql, values)).rows;
  },
  independentQuery: async (sql: string, values: unknown[] = []) => {
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
vi.mock("@/lib/env", () => ({ env: () => ({ DISCORD_GUILD_ID: "1332320879073296404" }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/server/services/discord", () => ({ getClanMembers: mocks.members, postMessage: mocks.post }));
vi.mock("@/server/services/loadout", () => ({ getConfig: async () => null }));

import { previewLoadoutReminder, sendLoadoutReminder } from "@/server/services/loadoutReminder";

const id = (n: number) => String(100000000000000000n + BigInt(n));
const actor = { discordId: id(900), displayName: "Owner" };
const requestId = "123e4567-e89b-42d3-a456-426614174000";

describe.skipIf(!process.env.TEST_DATABASE_URL)("loadout reminders with PostgreSQL", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await mocks.client.connect();
    await mocks.client.query("CREATE TEMP TABLE loadout_unlocks (discord_id text NOT NULL, item_key text NOT NULL, PRIMARY KEY (discord_id, item_key))");
    const migration = await readFile(resolve(process.cwd(), "migrations", "032_loadout_reminder_requests.sql"), "utf8");
    await mocks.client.query(migration.replace("CREATE TABLE", "CREATE TEMP TABLE"));
    mocks.members.mockResolvedValue({
      data: [{ id: id(1), bot: false }, { id: id(2), bot: false }], stale: false, fetchedAt: "2026-01-01",
    });
    mocks.post.mockResolvedValue(id(800));
  });

  afterEach(async () => {
    await mocks.client?.end();
    mocks.client = null;
  });

  it("persists a completed request and rejects a replay", async () => {
    await mocks.client!.query("INSERT INTO loadout_unlocks (discord_id, item_key) VALUES ($1, 'Galil')", [id(2)]);
    const preview = await previewLoadoutReminder();
    expect(preview.count).toBe(1);
    expect(await sendLoadoutReminder({ previewDigest: preview.previewDigest, requestId }, actor)).toMatchObject({ reminded: 1 });
    expect((await mocks.client!.query("SELECT actor_id, recipient_count, sent_count, status FROM loadout_reminder_requests")).rows[0])
      .toEqual({ actor_id: actor.discordId, recipient_count: 1, sent_count: 1, status: "sent" });
    await expect(sendLoadoutReminder({ previewDigest: preview.previewDigest, requestId }, actor)).rejects.toMatchObject({ code: "duplicate_reminder" });
    expect(mocks.post).toHaveBeenCalledOnce();
  });

  it("persists the failed outcome when Discord cannot confirm delivery", async () => {
    const preview = await previewLoadoutReminder();
    mocks.post.mockRejectedValue(new Error("Discord timed out"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(sendLoadoutReminder({ previewDigest: preview.previewDigest, requestId }, actor)).rejects.toMatchObject({ code: "reminder_failed" });
      expect((await mocks.client!.query("SELECT status, sent_count, error FROM loadout_reminder_requests")).rows[0])
        .toEqual({ status: "failed", sent_count: 0, error: "Discord timed out" });
      await expect(sendLoadoutReminder({ previewDigest: preview.previewDigest, requestId }, actor)).rejects.toMatchObject({ code: "duplicate_reminder" });
    } finally {
      log.mockRestore();
    }
  });
});
