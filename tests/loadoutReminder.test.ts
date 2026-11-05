import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  members: vi.fn(), config: vi.fn(), query: vi.fn(), independent: vi.fn(), post: vi.fn(), audit: vi.fn(), lock: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  query: mocks.query,
  independentQuery: mocks.independent,
  tx: mocks.transaction,
}));
vi.mock("@/lib/env", () => ({ env: () => ({ DISCORD_GUILD_ID: "1332320879073296404" }) }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/server/services/discord", () => ({ getClanMembers: mocks.members, postMessage: mocks.post }));
vi.mock("@/server/services/loadout", () => ({ getConfig: mocks.config }));

import { LOADOUT_REMINDER_CHANNEL_ID, previewLoadoutReminder, sendLoadoutReminder } from "@/server/services/loadoutReminder";

const owner = { discordId: "123456789012345678", displayName: "Owner" };
const requestId = "123e4567-e89b-42d3-a456-426614174000";
const member = (id: string, bot = false) => ({ id, displayName: id, roles: ["member-role"], bot });
const id = (index: number) => String(100000000000000000n + BigInt(index));
const snapshot = (data: ReturnType<typeof member>[]) => ({ data, stale: false, fetchedAt: "2026-01-01T00:00:00Z" });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.members.mockResolvedValue(snapshot([member(id(1)), member(id(2)), member(id(3), true)]));
  mocks.query.mockResolvedValue([{ discord_id: id(2) }]);
  mocks.config.mockResolvedValue({ channelId: id(20), messageId: id(21), postedAt: "2026-01-01" });
  mocks.lock.mockResolvedValue({ rows: [{ acquired: true }] });
  mocks.transaction.mockImplementation((fn: (client: { query: typeof mocks.lock }) => Promise<unknown>) => fn({ query: mocks.lock }));
  mocks.independent.mockImplementation(async (sql: string) => sql.includes("INSERT INTO loadout_reminder_requests") ? [{ request_id: requestId }] : []);
  mocks.post.mockResolvedValue(id(30));
  mocks.audit.mockResolvedValue(undefined);
});

describe("loadout unlock reminders", () => {
  it("only mentions current members with no recorded unlocks and includes the tracker link", async () => {
    const preview = await previewLoadoutReminder();
    expect(preview).toMatchObject({
      count: 1,
      trackerUrl: `https://discord.com/channels/1332320879073296404/${id(20)}/${id(21)}`,
    });
    expect(await sendLoadoutReminder({ previewDigest: preview.previewDigest, requestId }, owner)).toEqual({ ok: true, reminded: 1 });
    expect(mocks.members).toHaveBeenCalledWith(true);
    expect(mocks.post).toHaveBeenCalledWith(LOADOUT_REMINDER_CHANNEL_ID, expect.objectContaining({
      content: expect.stringContaining(`<@${id(1)}>`),
      allowed_mentions: { parse: [], users: [id(1)] },
    }));
    const payload = mocks.post.mock.calls[0]![1];
    expect(payload.content).toContain(preview.trackerUrl);
    expect(payload.content).not.toContain(id(2));
    expect(payload.content).not.toContain(id(3));
    expect(mocks.audit).toHaveBeenCalledWith(owner, "loadout.reminder_sent", "channel", LOADOUT_REMINDER_CHANNEL_ID, expect.objectContaining({ recipients: 1, confirmedSent: 1 }));
  });

  it("handles over 100 members without exceeding Discord message or mention limits", async () => {
    const ids = Array.from({ length: 205 }, (_, i) => id(i + 1));
    mocks.members.mockResolvedValue(snapshot(ids.map((value) => member(value))));
    mocks.query.mockResolvedValue([]);
    const preview = await previewLoadoutReminder();
    expect(await sendLoadoutReminder({ previewDigest: preview.previewDigest, requestId }, owner)).toEqual({ ok: true, reminded: 205 });
    const mentioned: string[] = [];
    for (const [channel, payload] of mocks.post.mock.calls) {
      expect(channel).toBe(LOADOUT_REMINDER_CHANNEL_ID);
      expect(payload.content.length).toBeLessThanOrEqual(2000);
      expect(payload.allowed_mentions.users.length).toBeLessThanOrEqual(100);
      expect(payload.allowed_mentions.parse).toEqual([]);
      for (const user of payload.allowed_mentions.users) expect(payload.content).toContain(`<@${user}>`);
      mentioned.push(...payload.allowed_mentions.users);
    }
    expect(mocks.post.mock.calls.length).toBeGreaterThan(1);
    expect(mentioned).toEqual(ids);
    expect(new Set(mentioned).size).toBe(205);
  });

  it("rejects stale Discord data even when the cache contains members", async () => {
    mocks.members.mockResolvedValue({ ...snapshot([member(id(1))]), stale: true, error: "unavailable" });
    await expect(previewLoadoutReminder()).rejects.toMatchObject({ status: 503, code: "stale_members" });
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("rejects a changed recipient set even when the count stays the same", async () => {
    const preview = await previewLoadoutReminder();
    mocks.members.mockResolvedValue(snapshot([member(id(4))]));
    await expect(sendLoadoutReminder({ previewDigest: preview.previewDigest, requestId }, owner))
      .rejects.toMatchObject({ status: 409, code: "reminder_changed" });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.independent).not.toHaveBeenCalled();
  });

  it("refuses a concurrent or duplicate request without posting", async () => {
    const preview = await previewLoadoutReminder();
    mocks.lock.mockResolvedValueOnce({ rows: [{ acquired: false }] });
    await expect(sendLoadoutReminder({ previewDigest: preview.previewDigest, requestId }, owner)).rejects.toMatchObject({ code: "reminder_in_progress" });
    mocks.independent.mockResolvedValueOnce([]);
    await expect(sendLoadoutReminder({ previewDigest: preview.previewDigest, requestId }, owner)).rejects.toMatchObject({ code: "duplicate_reminder" });
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("does not post an empty reminder and works when the tracker is not configured", async () => {
    mocks.config.mockResolvedValue(null);
    mocks.query.mockResolvedValue([{ discord_id: id(1) }, { discord_id: id(2) }]);
    const preview = await previewLoadoutReminder();
    expect(preview).toMatchObject({ count: 0, trackerUrl: null });
    await expect(sendLoadoutReminder({ previewDigest: preview.previewDigest, requestId }, owner)).rejects.toMatchObject({ code: "no_recipients" });
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("reports partial or uncertain delivery and audits the confirmed count", async () => {
    mocks.members.mockResolvedValue(snapshot(Array.from({ length: 110 }, (_, i) => member(id(i + 1)))));
    mocks.query.mockResolvedValue([]);
    const preview = await previewLoadoutReminder();
    mocks.post.mockResolvedValueOnce(id(30)).mockRejectedValueOnce(new Error("Discord unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(sendLoadoutReminder({ previewDigest: preview.previewDigest, requestId }, owner))
        .rejects.toMatchObject({ code: "reminder_failed", message: expect.stringContaining("Check the Discord channel before retrying") });
      const sent = mocks.post.mock.calls[0]![1].allowed_mentions.users.length;
      expect(mocks.audit).toHaveBeenCalledWith(owner, "loadout.reminder_failed", "channel", LOADOUT_REMINDER_CHANNEL_ID, expect.objectContaining({ recipients: 110, confirmedSent: sent }));
      expect(mocks.independent).toHaveBeenCalledWith(expect.stringContaining("status = 'failed'"), expect.arrayContaining([requestId]));
    } finally {
      log.mockRestore();
    }
  });

  it("reports uncertainty if the lock transaction fails after Discord accepted a message", async () => {
    const preview = await previewLoadoutReminder();
    mocks.transaction.mockImplementation(async (fn: (client: { query: typeof mocks.lock }) => Promise<unknown>) => {
      await fn({ query: mocks.lock });
      throw new Error("Database connection lost on commit");
    });
    await expect(sendLoadoutReminder({ previewDigest: preview.previewDigest, requestId }, owner))
      .rejects.toMatchObject({ code: "reminder_outcome_unknown", message: expect.stringContaining("1 of 1 recipients were confirmed sent") });
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith(owner, "loadout.reminder_failed", "channel", LOADOUT_REMINDER_CHANNEL_ID, expect.objectContaining({ confirmedSent: 1 }));
  });

  it("fails closed for duplicate or malformed member IDs and invalid tracker links", async () => {
    mocks.members.mockResolvedValue(snapshot([member(id(1)), member(id(1))]));
    await expect(previewLoadoutReminder()).rejects.toMatchObject({ code: "invalid_members" });
    mocks.members.mockResolvedValue(snapshot([member("bad")]));
    await expect(previewLoadoutReminder()).rejects.toMatchObject({ code: "invalid_members" });
    mocks.members.mockResolvedValue(snapshot([member(id(1))]));
    mocks.config.mockResolvedValue({ channelId: "invalid", messageId: id(21) });
    await expect(previewLoadoutReminder()).rejects.toMatchObject({ code: "invalid_tracker" });
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
