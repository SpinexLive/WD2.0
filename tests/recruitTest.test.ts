import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: null as import("pg").Client | null,
  report: vi.fn(),
  stats: vi.fn(),
  sync: vi.fn(),
  players: vi.fn(),
  message: vi.fn(),
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
vi.mock("@/lib/env", () => ({ env: () => ({ DISCORD_GUILD_ID: "guild" }) }));
vi.mock("@/server/services/discord", () => ({ postMessage: vi.fn(), editMessage: vi.fn(), hasAuthorisedRole: () => true }));
vi.mock("@/server/services/matchHistory", () => ({ matchSyncStatus: mocks.sync }));
vi.mock("@/server/services/recruit", () => ({ buildRecruitReport: mocks.report, recruitPlayerStats: mocks.stats }));
vi.mock("@/server/services/seedingRcon", () => ({ gamePlayers: mocks.players, messageGamePlayer: mocks.message }));

import { HttpError, ProviderError } from "@/lib/http";
import { GAME_MESSAGE_LIMIT, gameMessageSize } from "@/lib/gameMessage";
import { recruitButton } from "@/server/services/recruitAlerts";
import { recruitTestPlayers, sendRecruitTest } from "@/server/services/recruitTest";

const player = { steamId: "76561198000000001", name: "Alpha", faction: "Lonestar" };
const candidate = { ...player, matches: 3, kd: 2.5, avgCash: 45000, status: "new" };
const actor = { discordId: "123456789012345678", displayName: "Owner" };
const firstRequest = "123e4567-e89b-42d3-a456-426614174000";
const secondRequest = "123e4567-e89b-42d3-a456-426614174001";
const messageId = "111111111111111111";

describe.skipIf(!process.env.TEST_DATABASE_URL)("admin recruit tests with PostgreSQL", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await mocks.client.connect();
    for (const file of ["029_recruit_alerts.sql", "030_recruit_tests.sql"]) {
      const migration = await readFile(resolve(process.cwd(), "migrations", file), "utf8");
      await mocks.client.query(migration.replace(/CREATE TABLE/g, "CREATE TEMP TABLE"));
    }
    await mocks.client.query(await readFile(resolve(process.cwd(), "migrations", "031_recruit_embed_sync.sql"), "utf8"));
    await mocks.client.query(`
      CREATE TEMP TABLE recruit_status (
        steam_id text PRIMARY KEY, status text NOT NULL, note text, updated_by_id text NOT NULL,
        updated_by_name text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TEMP TABLE audit_logs (
        actor_id text NOT NULL, actor_name text, action text NOT NULL,
        target_type text, target_id text, details jsonb
      );
    `);
    mocks.sync.mockReturnValue({ lastRunAt: Date.now(), syncing: false, pending: 0, failed: false });
    mocks.report.mockResolvedValue({ candidates: [] });
    mocks.players.mockResolvedValue({ count: 1, players: [player] });
    mocks.stats.mockResolvedValue(new Map([[player.steamId, { ...candidate, kd: 2.504, avgCash: 45000.4 }]]));
    mocks.message.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await mocks.client?.end();
    mocks.client = null;
  });

  async function preview() {
    const result = (await recruitTestPlayers()).players[0]!;
    expect(result.previewDigest).toBeTruthy();
    return result;
  }
  async function send(requestId = firstRequest) {
    const p = await preview();
    return sendRecruitTest({ steamId: p.steamId, requestId, previewDigest: p.previewDigest! }, actor);
  }
  async function postAlert() {
    await mocks.client!.query(
      "INSERT INTO recruit_alerts (steam_id, candidate, post_status, discord_message_id) VALUES ($1, $2, 'posted', $3)",
      [player.steamId, JSON.stringify(candidate), messageId],
    );
  }

  it("uses the real stored values and sends the exact preview to a connected non-recruit", async () => {
    const p = await preview();
    expect(p.stats).toEqual({ matches: 3, kd: 2.5, avgCash: 45000 });
    expect(p.willCount).toBe(false);
    expect(p.message).toContain("Hey Alpha, Spinex here leader of Remnant! Your 3 matches, 2.50 K/D and 45,000 average cash");
    const result = await sendRecruitTest({ steamId: p.steamId, requestId: firstRequest, previewDigest: p.previewDigest! }, actor);
    expect(result).toMatchObject({ ok: true, playerName: "Alpha", countedAsInvitation: false });
    expect(mocks.message).toHaveBeenCalledWith(player.steamId, p.message);
    expect((await mocks.client!.query("SELECT count(*)::int AS n FROM recruit_status")).rows[0].n).toBe(0);
    expect((await mocks.client!.query("SELECT action, target_id FROM audit_logs")).rows[0])
      .toEqual({ action: "recruit.test_invited", target_id: player.steamId });
    await send(secondRequest);
    expect(mocks.message).toHaveBeenCalledTimes(2);
  });

  it("previews and sends the shortened message when the original would be too long", async () => {
    const name = "123456789";
    mocks.players.mockResolvedValue({ count: 1, players: [{ ...player, name }] });
    const p = await preview();
    expect(p.message).toContain(name);
    expect(gameMessageSize(p.message!)).toBeLessThanOrEqual(GAME_MESSAGE_LIMIT);
    await sendRecruitTest({ steamId: p.steamId, requestId: firstRequest, previewDigest: p.previewDigest! }, actor);
    expect(mocks.message).toHaveBeenCalledWith(player.steamId, p.message);
  });

  it("allows a new test after the server previously rejected an overlong message", async () => {
    await mocks.client!.query(
      `INSERT INTO recruit_test_attempts (request_id, steam_id, actor_id, tracked_recruit, status, error)
       VALUES ($1, $2, $3, false, 'failed', 'message is 258 characters; the limit is 256')`,
      [firstRequest, player.steamId, actor.discordId],
    );
    const name = "123456789";
    mocks.players.mockResolvedValue({ count: 1, players: [{ ...player, name }] });
    const p = await preview();
    expect(await sendRecruitTest({ steamId: p.steamId, requestId: secondRequest, previewDigest: p.previewDigest! }, actor))
      .toMatchObject({ ok: true });
    expect(mocks.message).toHaveBeenCalledWith(player.steamId, p.message);
    expect(gameMessageSize(p.message!)).toBeLessThanOrEqual(GAME_MESSAGE_LIMIT);
  });

  it("marks only the player with unfit statistics unavailable", async () => {
    const other = { steamId: "76561198000000002", name: "Bravo", faction: "Lonestar" };
    mocks.players.mockResolvedValue({ count: 2, players: [player, other] });
    mocks.stats.mockResolvedValue(new Map([
      [player.steamId, { ...candidate, avgCash: 1e300 }],
      [other.steamId, { ...candidate, steamId: other.steamId }],
    ]));
    const result = await recruitTestPlayers();
    expect(result.players.find((p) => p.steamId === player.steamId)).toMatchObject({
      message: null, previewDigest: null, unavailable: expect.stringContaining("cannot fit"),
    });
    expect(result.players.find((p) => p.steamId === other.steamId)).toMatchObject({ unavailable: null, message: expect.any(String) });
  });

  it("blocks players without real stored stats and never fabricates message values", async () => {
    mocks.stats.mockResolvedValue(new Map());
    const p = (await recruitTestPlayers()).players[0]!;
    expect(p).toMatchObject({ stats: null, message: null, previewDigest: null, unavailable: expect.stringContaining("not all available") });
    await expect(sendRecruitTest({ steamId: player.steamId, requestId: firstRequest, previewDigest: "a".repeat(64) }, actor)).rejects.toThrow("not all available");
    expect(mocks.message).not.toHaveBeenCalled();
  });

  it("counts a test sent to a recruit as their invitation and blocks the Discord button", async () => {
    mocks.report.mockResolvedValue({ candidates: [candidate] });
    await postAlert();
    const p = await preview();
    expect(p.willCount).toBe(true);
    expect(await sendRecruitTest({ steamId: p.steamId, requestId: firstRequest, previewDigest: p.previewDigest! }, actor))
      .toMatchObject({ countedAsInvitation: true });
    expect((await mocks.client!.query("SELECT invite_status FROM recruit_alerts")).rows[0].invite_status).toBe("sent");
    expect((await mocks.client!.query("SELECT status FROM recruit_status")).rows[0].status).toBe("contacted");
    expect(await recruitButton({ guildId: "guild", channelId: "1560238091543912558", messageId, userId: actor.discordId, roles: ["staff"], customId: `wdrecruit:invite:${player.steamId}` }))
      .toContain("already received");
    expect(mocks.message).toHaveBeenCalledOnce();
  });

  it("blocks an admin test after the Discord invitation has already been sent", async () => {
    mocks.report.mockResolvedValue({ candidates: [candidate] });
    await postAlert();
    expect(await recruitButton({ guildId: "guild", channelId: "1560238091543912558", messageId, userId: actor.discordId, roles: ["staff"], customId: `wdrecruit:invite:${player.steamId}` }))
      .toContain("Invitation sent");
    const p = (await recruitTestPlayers()).players[0]!;
    expect(p.unavailable).toContain("already been invited");
    await expect(sendRecruitTest({ steamId: p.steamId, requestId: firstRequest, previewDigest: p.previewDigest! }, actor)).rejects.toThrow("already been invited");
    expect(mocks.message).toHaveBeenCalledOnce();
  });

  it("records an eligible recruit even when they have not yet been announced", async () => {
    mocks.report.mockResolvedValue({ candidates: [candidate] });
    expect(await send()).toMatchObject({ countedAsInvitation: true });
    expect((await mocks.client!.query("SELECT post_status, invite_status FROM recruit_alerts")).rows[0])
      .toEqual({ post_status: "baseline", invite_status: "sent" });
    expect((await mocks.client!.query("SELECT status FROM recruit_status")).rows[0].status).toBe("contacted");
  });

  it("rejects a player who left or whose preview changed before sending", async () => {
    const p = await preview();
    mocks.players.mockResolvedValueOnce({ count: 0, players: [] });
    await expect(sendRecruitTest({ steamId: p.steamId, requestId: firstRequest, previewDigest: p.previewDigest! }, actor)).rejects.toThrow("no longer online");
    mocks.stats.mockResolvedValue(new Map([[player.steamId, { ...candidate, kd: 4 }]]));
    await expect(sendRecruitTest({ steamId: p.steamId, requestId: firstRequest, previewDigest: p.previewDigest! }, actor)).rejects.toThrow("stats changed");
    expect(mocks.message).not.toHaveBeenCalled();
  });

  it("does not allow a repeated request ID to send a second message", async () => {
    await send();
    await expect(send()).rejects.toThrow("already sent");
    expect(mocks.message).toHaveBeenCalledOnce();
  });

  it("prevents a Discord invitation while a recruit test is in progress", async () => {
    mocks.report.mockResolvedValue({ candidates: [candidate] });
    await postAlert();
    let finish!: () => void;
    mocks.message.mockImplementationOnce(() => new Promise<void>((done) => { finish = done; }));
    const p = await preview();
    const running = sendRecruitTest({ steamId: p.steamId, requestId: firstRequest, previewDigest: p.previewDigest! }, actor);
    await vi.waitFor(() => expect(mocks.message).toHaveBeenCalledOnce());
    expect(await recruitButton({ guildId: "guild", channelId: "1560238091543912558", messageId, userId: actor.discordId, roles: ["staff"], customId: `wdrecruit:invite:${player.steamId}` }))
      .toContain("already being sent");
    finish();
    await running;
    expect(mocks.message).toHaveBeenCalledOnce();
  });

  it("locks uncertain deliveries, including for players who are not recruits", async () => {
    mocks.message.mockRejectedValue(new Error("network timeout"));
    await expect(send()).rejects.toThrow("Could not confirm");
    expect((await mocks.client!.query("SELECT status FROM recruit_test_attempts")).rows[0].status).toBe("unknown");
    expect((await recruitTestPlayers()).players[0]!.unavailable).toContain("delivery is unknown");
    await expect(send(secondRequest)).rejects.toThrow("delivery is unknown");
    expect(mocks.message).toHaveBeenCalledOnce();
  });

  it("also locks the Discord button if a recruit test has an uncertain outcome", async () => {
    mocks.report.mockResolvedValue({ candidates: [candidate] });
    await postAlert();
    mocks.message.mockRejectedValue(new Error("network timeout"));
    await expect(send()).rejects.toThrow("Could not confirm");
    expect((await mocks.client!.query("SELECT invite_status FROM recruit_alerts")).rows[0].invite_status).toBe("unknown");
    expect(await recruitButton({ guildId: "guild", channelId: "1560238091543912558", messageId, userId: actor.discordId, roles: ["staff"], customId: `wdrecruit:invite:${player.steamId}` }))
      .toContain("outcome is unknown");
    expect(mocks.message).toHaveBeenCalledOnce();
  });

  it("allows retry after explicit rejection and removes a newly created recruit claim", async () => {
    mocks.report.mockResolvedValue({ candidates: [candidate] });
    mocks.message.mockRejectedValueOnce(new ProviderError("game-rcon", "Player disconnected", 404));
    await expect(send()).rejects.toThrow("rejected");
    expect((await mocks.client!.query("SELECT count(*)::int AS n FROM recruit_alerts")).rows[0].n).toBe(0);
    expect(await send(secondRequest)).toMatchObject({ countedAsInvitation: true });
    expect(mocks.message).toHaveBeenCalledTimes(2);
  });

  it("treats a local message-length validation error as a known rejection", async () => {
    mocks.report.mockResolvedValue({ candidates: [candidate] });
    mocks.message.mockRejectedValue(new HttpError(400, "Message too long", "game_message_too_long"));
    await expect(send()).rejects.toMatchObject({ code: "test_rejected" });
    expect((await mocks.client!.query("SELECT status FROM recruit_test_attempts")).rows[0].status).toBe("failed");
    expect((await mocks.client!.query("SELECT count(*)::int AS n FROM recruit_alerts")).rows[0].n).toBe(0);
  });

  it("fails closed when match history or required candidate data is unavailable", async () => {
    mocks.sync.mockReturnValue({ lastRunAt: 0, syncing: true, pending: 1, failed: false });
    await expect(recruitTestPlayers()).rejects.toThrow("match history sync");
    mocks.sync.mockReturnValue({ lastRunAt: Date.now(), syncing: false, pending: 0, failed: false });
    mocks.report.mockRejectedValue(new Error("Account links are stale"));
    await expect(recruitTestPlayers()).rejects.toThrow("Account links are stale");
    mocks.report.mockRejectedValue(new HttpError(409, "No benchmark", "no_benchmark"));
    expect((await recruitTestPlayers()).players[0]!.willCount).toBe(false);
  });
});
