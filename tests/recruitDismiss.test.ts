import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: null as import("pg").Client | null, edit: vi.fn() }));
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
vi.mock("@/server/services/discord", () => ({ editMessage: mocks.edit }));

import type { Session } from "@/lib/session";
import { setRecruitStatus } from "@/server/services/recruit";
import { subscribe } from "@/server/services/bus";

const steamId = "76561198000000001";
const messageId = "111111111111111111";
const candidate = { steamId, name: "Alpha", matches: 3, kd: 2.5, avgCash: 45000 };
const actor: Session = {
  id: "session", discordId: "123456789012345678", username: "staff", displayName: "Staff member",
  avatarUrl: "", csrfToken: "csrf", isAdmin: true, canViewMembers: false, isReviewer: false, canManageNews: false,
};

describe.skipIf(!process.env.TEST_DATABASE_URL)("dashboard recruit status and Discord embed", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await mocks.client.connect();
    const migration = await readFile(resolve(process.cwd(), "migrations", "029_recruit_alerts.sql"), "utf8");
    await mocks.client.query(migration.replace(/CREATE TABLE/g, "CREATE TEMP TABLE"));
    await mocks.client.query(await readFile(resolve(process.cwd(), "migrations", "031_recruit_embed_sync.sql"), "utf8"));
    await mocks.client.query(`
      CREATE TEMP TABLE recruit_status (
        steam_id text PRIMARY KEY, status text NOT NULL, note text, updated_by_id text NOT NULL,
        updated_by_name text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TEMP TABLE audit_logs (
        actor_id text NOT NULL, actor_name text, action text NOT NULL, target_type text, target_id text, details jsonb
      );
    `);
    await mocks.client.query(
      "INSERT INTO recruit_alerts (steam_id, candidate, post_status, discord_message_id) VALUES ($1, $2, 'posted', $3)",
      [steamId, JSON.stringify(candidate), messageId],
    );
    mocks.edit.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await mocks.client?.end();
    mocks.client = null;
  });

  it("reflects dashboard dismissals and restoration in Discord without pinging roles", async () => {
    const events: string[] = [];
    const unsubscribe = subscribe((event) => events.push(event.topic));
    try {
      expect(await setRecruitStatus(actor, steamId, { status: "dismissed" })).toEqual({ ok: true, discordSyncError: null });
      expect((await mocks.client!.query("SELECT status FROM recruit_status")).rows[0].status).toBe("dismissed");
      expect(mocks.edit).toHaveBeenLastCalledWith("1560238091543912558", messageId, expect.objectContaining({
        allowed_mentions: { parse: [] },
        components: [expect.objectContaining({ components: expect.arrayContaining([expect.objectContaining({ label: "Dismissed", disabled: true })]) })],
      }));

      expect(await setRecruitStatus(actor, steamId, { status: "new" })).toEqual({ ok: true, discordSyncError: null });
      expect((await mocks.client!.query("SELECT count(*)::int AS n FROM recruit_status")).rows[0].n).toBe(0);
      expect(mocks.edit).toHaveBeenLastCalledWith("1560238091543912558", messageId, expect.objectContaining({
        components: [expect.objectContaining({ components: expect.arrayContaining([
          expect.objectContaining({ label: "Dismiss", disabled: false }),
          expect.objectContaining({ label: "Send in-game invitation", disabled: false }),
        ]) })],
      }));
      expect(events).toEqual(["recruit", "recruit"]);
      expect((await mocks.client!.query("SELECT action FROM audit_logs ORDER BY action")).rows)
        .toEqual([{ action: "recruit.dismissed" }, { action: "recruit.new" }]);
    } finally {
      unsubscribe();
    }
  });

  it("does not change status while an invitation is in flight", async () => {
    await mocks.client!.query("UPDATE recruit_alerts SET invite_status = 'sending' WHERE steam_id = $1", [steamId]);
    await expect(setRecruitStatus(actor, steamId, { status: "dismissed" })).rejects.toMatchObject({ status: 409, code: "invite_in_progress" });
    expect((await mocks.client!.query("SELECT count(*)::int AS n FROM recruit_status")).rows[0].n).toBe(0);
    expect(mocks.edit).not.toHaveBeenCalled();
  });

  it("preserves the dashboard change and reports an embed update failure for retry", async () => {
    mocks.edit.mockRejectedValue(new Error("Discord unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await setRecruitStatus(actor, steamId, { status: "dismissed" }))
        .toMatchObject({ ok: true, discordSyncError: expect.stringContaining("Discord message could not be updated") });
      expect((await mocks.client!.query("SELECT status FROM recruit_status")).rows[0].status).toBe("dismissed");
      expect((await mocks.client!.query("SELECT embed_error FROM recruit_alerts")).rows[0].embed_error).toBe("Discord unavailable");
    } finally {
      log.mockRestore();
    }
  });
});
