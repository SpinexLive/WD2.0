import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: null as import("pg").Client | null,
  report: vi.fn(),
  sync: vi.fn(),
  post: vi.fn(),
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
vi.mock("@/server/services/discord", () => ({
  postMessage: mocks.post,
  hasAuthorisedRole: (roles: string[]) => roles.includes("staff"),
}));
vi.mock("@/server/services/seedingRcon", () => ({ gamePlayers: mocks.players, messageGamePlayer: mocks.message }));
vi.mock("@/server/services/matchHistory", () => ({ matchSyncStatus: mocks.sync }));
vi.mock("@/server/services/recruit", () => ({ buildRecruitReport: mocks.report }));

import { ProviderError } from "@/lib/http";
import {
  postPendingRecruitAlerts, recruitAlertPayload, recruitAlertStatus, recruitButton,
  recruitInvitation, RECRUIT_CHANNEL_ID, scanRecruitCandidates,
} from "@/server/services/recruitAlerts";

const first = { steamId: "76561198000000001", name: "Alpha", matches: 3, kd: 2.5, avgCash: 45000, status: "new" };
const second = { steamId: "76561198000000002", name: "Bravo", matches: 5, kd: 3.2, avgCash: 57000, status: "new" };
const guildId = "guild";
const messageId = "111111111111111111";
const button = (steamId: string, roles = ["1547229723141345351"]) => ({
  guildId, channelId: RECRUIT_CHANNEL_ID, messageId, userId: "123456789012345678",
  actorName: "Staff member", roles, customId: `wdrecruit:invite:${steamId}`,
});

describe("recruit notification content", () => {
  it("uses the requested personal message and player statistics", () => {
    expect(recruitInvitation(first, "Alpha")).toBe(
      "Hey Alpha, Spinex here leader of Remnant! Your 3 matches, 2.50 K/D and 45,000 average cash caught our eye. Your stats stack up well against our top players, and we'd love you on the team. If youre interested in comp matches come say Hi: discord.gg/rmntgg",
    );
  });

  it("mentions only the requested roles and includes the player's details and button", () => {
    expect(recruitAlertPayload(first)).toMatchObject({
      content: "<@&1546188874986950758> <@&1547229723141345351>",
      allowed_mentions: { parse: [], roles: ["1546188874986950758", "1547229723141345351"] },
      embeds: [{ fields: expect.arrayContaining([
        { name: "Player", value: "Alpha", inline: true },
        { name: "K/D", value: "2.50", inline: true },
        { name: "Steam ID", value: first.steamId, inline: false },
      ]) }],
      components: [{ components: [{ custom_id: `wdrecruit:invite:${first.steamId}` }] }],
    });
  });
});

const testDatabase = process.env.TEST_DATABASE_URL;
describe.skipIf(!testDatabase)("recruit alerts with PostgreSQL", () => {
  beforeEach(async () => {
    if (!testDatabase) throw new Error("TEST_DATABASE_URL is required");
    vi.resetAllMocks();
    mocks.client = new pg.Client({ connectionString: testDatabase });
    await mocks.client.connect();
    const migration = await readFile(resolve(process.cwd(), "migrations", "029_recruit_alerts.sql"), "utf8");
    await mocks.client.query(migration.replace(/CREATE TABLE/g, "CREATE TEMP TABLE"));
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
    mocks.report.mockResolvedValue({ candidates: [first] });
    mocks.post.mockResolvedValue(messageId);
    mocks.players.mockResolvedValue({ count: 1, players: [{ steamId: first.steamId, name: "Alpha", faction: "Lonestar" }] });
    mocks.message.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await mocks.client?.end();
    mocks.client = null;
  });

  async function posted() {
    await mocks.client!.query(
      "INSERT INTO recruit_alerts (steam_id, candidate, post_status, discord_message_id) VALUES ($1, $2, 'posted', $3)",
      [first.steamId, JSON.stringify(first), messageId],
    );
  }

  it("baselines existing candidates, then posts once only for a newly identified candidate", async () => {
    const client = mocks.client!;
    await scanRecruitCandidates();
    await postPendingRecruitAlerts();
    expect(mocks.post).not.toHaveBeenCalled();

    mocks.report.mockResolvedValue({ candidates: [first, second] });
    await scanRecruitCandidates();
    await postPendingRecruitAlerts();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith(RECRUIT_CHANNEL_ID, recruitAlertPayload(second));
    await scanRecruitCandidates();
    await postPendingRecruitAlerts();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect((await client.query("SELECT steam_id, post_status FROM recruit_alerts ORDER BY steam_id")).rows).toEqual([
      { steam_id: first.steamId, post_status: "baseline" },
      { steam_id: second.steamId, post_status: "posted" },
    ]);
    expect(mocks.report).toHaveBeenCalledWith({ strictSources: true });
  });

  it("waits for the match archive to finish before establishing the baseline", async () => {
    mocks.sync.mockReturnValue({ lastRunAt: 0, syncing: true, pending: 5, failed: false });
    await scanRecruitCandidates();
    expect(mocks.report).not.toHaveBeenCalled();
    expect((await recruitAlertStatus()).initialized).toBe(false);
  });

  it("does not establish the baseline if candidate sources are unavailable", async () => {
    mocks.report.mockRejectedValue(new Error("Discord member data is stale"));
    await expect(scanRecruitCandidates()).rejects.toThrow("stale");
    expect((await recruitAlertStatus()).initialized).toBe(false);
    expect((await mocks.client!.query("SELECT count(*)::int AS n FROM recruit_alerts")).rows[0].n).toBe(0);
  });

  it("allows a requested role to invite an online player once and records the action", async () => {
    await posted();
    expect(await recruitButton(button(first.steamId))).toContain("Invitation sent");
    expect(mocks.message).toHaveBeenCalledOnce();
    expect(mocks.message).toHaveBeenCalledWith(first.steamId, recruitInvitation(first, "Alpha"));
    expect(await recruitButton(button(first.steamId, ["staff"]))).toContain("already received");
    expect(mocks.message).toHaveBeenCalledOnce();
    expect((await mocks.client!.query("SELECT status, updated_by_id FROM recruit_status")).rows[0])
      .toEqual({ status: "contacted", updated_by_id: button(first.steamId).userId });
    expect((await mocks.client!.query("SELECT action, target_id FROM audit_logs")).rows[0])
      .toEqual({ action: "recruit.invited", target_id: first.steamId });
  });

  it("rejects unauthorized and wrong-message clicks before contacting the game", async () => {
    await posted();
    expect(await recruitButton(button(first.steamId, ["other"]))).toContain("Only authorised");
    expect(await recruitButton({ ...button(first.steamId), messageId: "222222222222222222" })).toContain("no longer active");
    expect(mocks.players).not.toHaveBeenCalled();
    expect(mocks.message).not.toHaveBeenCalled();
  });

  it.each([["staff"], ["1546188874986950758"], ["1547229723141345351"]])(
    "allows the requested role or authorised staff role %s",
    async (role) => {
      await posted();
      mocks.players.mockResolvedValue({ count: 0, players: [] });
      expect(await recruitButton(button(first.steamId, [role]))).toContain("not currently on the game server");
    },
  );

  it("leaves an offline player available for a later invitation", async () => {
    await posted();
    mocks.players.mockResolvedValue({ count: 0, players: [] });
    expect(await recruitButton(button(first.steamId))).toContain("not currently on the game server");
    expect((await mocks.client!.query("SELECT invite_status FROM recruit_alerts")).rows[0].invite_status).toBe("ready");
    expect(mocks.message).not.toHaveBeenCalled();
  });

  it("does not invite a player who is no longer a suitable new candidate", async () => {
    await posted();
    mocks.report.mockResolvedValue({ candidates: [] });
    expect(await recruitButton(button(first.steamId))).toContain("no longer a new, suitable recruit");
    expect(mocks.players).not.toHaveBeenCalled();
    expect(mocks.message).not.toHaveBeenCalled();
  });

  it("blocks another click while the first invitation is in flight", async () => {
    await posted();
    let finish!: () => void;
    mocks.message.mockImplementationOnce(() => new Promise<void>((resolveMessage) => { finish = resolveMessage; }));
    const firstClick = recruitButton(button(first.steamId));
    await vi.waitFor(() => expect(mocks.message).toHaveBeenCalledOnce());
    expect(await recruitButton(button(first.steamId))).toContain("already being sent");
    finish();
    expect(await firstClick).toContain("Invitation sent");
    expect(mocks.message).toHaveBeenCalledOnce();
  });

  it("locks an invitation with an uncertain outcome to prevent duplicates", async () => {
    await posted();
    mocks.message.mockRejectedValue(new Error("network timeout"));
    expect(await recruitButton(button(first.steamId))).toContain("Could not confirm");
    expect((await recruitAlertStatus()).uncertainInvites).toBe(1);
    expect(await recruitButton(button(first.steamId))).toContain("outcome is unknown");
    expect(mocks.message).toHaveBeenCalledOnce();
  });

  it("allows retry after an explicit game-server rejection", async () => {
    await posted();
    mocks.message.mockRejectedValueOnce(new ProviderError("game-rcon", "Player disconnected", 404));
    expect(await recruitButton(button(first.steamId))).toContain("rejected");
    expect((await mocks.client!.query("SELECT invite_status FROM recruit_alerts")).rows[0].invite_status).toBe("ready");
    expect(await recruitButton(button(first.steamId))).toContain("Invitation sent");
  });

  it("keeps an uncertain Discord post locked instead of posting it again", async () => {
    await scanRecruitCandidates();
    mocks.report.mockResolvedValue({ candidates: [first, second] });
    await scanRecruitCandidates();
    mocks.post.mockRejectedValue(new Error("network timeout"));
    await expect(postPendingRecruitAlerts()).rejects.toThrow("could not be posted");
    await postPendingRecruitAlerts();
    expect(mocks.post).toHaveBeenCalledOnce();
    expect((await recruitAlertStatus()).uncertainPosts).toBe(1);
  });
});
