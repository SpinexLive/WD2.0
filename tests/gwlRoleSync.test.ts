import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), audit: vi.fn(), raw: vi.fn(), scheduledEvent: vi.fn(), scheduled: vi.fn(), channel: vi.fn(),
  prepare: vi.fn(), rename: vi.fn(), update: vi.fn(), verify: vi.fn(), absent: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ env: () => ({ DISCORD_GUILD_ID: "guild" }) }));
vi.mock("@/lib/db", () => ({ query: mocks.query, independentQuery: mocks.query }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/server/services/leagueRaidHelper", () => ({
  LEAGUE_EVENT_CHANNEL: "channel", getRawLeagueEvent: mocks.raw, getScheduledLeagueEvent: mocks.scheduledEvent,
  getScheduledLeagueEvents: mocks.scheduled, isLeagueEventChannel: mocks.channel,
  prepareLeagueRoleRename: mocks.prepare, renameLeagueRole: mocks.rename,
  updateLeagueTempRole: mocks.update, verifyLeagueRoleRename: mocks.verify, verifyLeagueRoleAbsent: mocks.absent,
  otherLeagueSettingsUnchanged: () => true,
}));

import { syncGwlEventRole } from "@/server/services/gwlRoleSync";
import type { Row } from "@/server/services/gwlOpenSlots";

const oldName = "GWL | RMNT v TLL v TBD";
const newName = "GWL | RMNT v TLL v ???";
const roleId = "1573034940067483668";
const startsAt = "2099-01-21T19:30:00Z";
const start = Date.parse(startsAt) / 1000 - 1800;
const row = (): Row => ({
  match_number: "42", fixture: { number: "42", status: "scheduled", startsAt, map: "map", layer: null, region: "EU", sides: [] },
  state: "posted", scheduled_id: null, event_id: "event1", event_channel_id: "thread",
  start_time: String(start), post_at: null, temporary_role: newName,
  member_role_name: "Member", voice_channel_name: "Briefing", error: null, updated_at: new Date(),
});
const event = () => ({
  id: "event1", serverId: "guild", channelId: "thread", title: newName, templateId: "ct34",
  startTime: start, description: "**Competition:** GWL\n**Match:** #42",
  advancedSettings: { temp_role: oldName }, temporaryRole: roleId, signUps: [{ id: 1, userId: "player" }],
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.audit.mockResolvedValue(undefined);
  mocks.channel.mockResolvedValue(true);
  mocks.prepare.mockResolvedValue(roleId);
  mocks.rename.mockResolvedValue(undefined);
  mocks.verify.mockResolvedValue(undefined);
  mocks.absent.mockResolvedValue(undefined);
});

describe("GWL existing temporary roles", () => {
  it("renames the existing role and updates the setting without dropping signups", async () => {
    const record = row();
    const current = event();
    mocks.raw.mockImplementation(async () => current);
    mocks.update.mockImplementation(async () => { current.advancedSettings.temp_role = newName; });
    mocks.query.mockImplementation(async (sql: string) => sql.includes("RETURNING match_number") ? [record] : []);
    await syncGwlEventRole(record, async () => true);
    expect(mocks.prepare).toHaveBeenCalledWith("event1", oldName, newName, false, newName);
    expect(mocks.rename).toHaveBeenCalledWith(roleId, oldName, newName);
    expect(mocks.update).toHaveBeenCalledWith("event1", newName);
    expect(mocks.verify).toHaveBeenCalledWith(roleId, oldName, newName);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("SET state = $2, error = NULL"), [record.match_number, "posted", expect.any(String)]);
  });

  it("marks ambiguous roles for review without making external changes", async () => {
    const record = row();
    mocks.raw.mockResolvedValue(event());
    mocks.prepare.mockRejectedValue(new HttpError(409, "Ambiguous role", "gwl_slot_unsafe"));
    await syncGwlEventRole(record, async () => true);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("state = 'review'"), expect.arrayContaining([record.match_number]));
    expect(mocks.rename).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not mutate when GWL changes during the safety checks", async () => {
    mocks.raw.mockResolvedValue(event());
    await syncGwlEventRole(row(), async () => false);
    expect(mocks.rename).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("leaves an unconfirmed update uncertain and does not retry", async () => {
    const record = row();
    const current = event();
    mocks.raw.mockImplementation(async () => current);
    mocks.update.mockImplementation(async () => { current.advancedSettings.temp_role = newName; current.signUps = []; });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SET state = 'uncertain'")) { record.state = "uncertain"; return [record]; }
      return [];
    });

    await expect(syncGwlEventRole(record, async () => true)).rejects.toThrow("could not be confirmed");
    await syncGwlEventRole(record, async () => true);
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(record.state).toBe("uncertain");
  });

  it("does not patch Raid Helper after an unconfirmed Discord rename", async () => {
    const record = row();
    mocks.raw.mockResolvedValue(event());
    mocks.rename.mockRejectedValue(new Error("timeout"));
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SET state = 'uncertain'")) { record.state = "uncertain"; return [record]; }
      return [];
    });
    await expect(syncGwlEventRole(record, async () => true)).rejects.toThrow("could not be confirmed");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(record.state).toBe("uncertain");
  });

  it("updates a verified scheduled event without renaming a Discord role", async () => {
    const record = row();
    record.state = "scheduled"; record.scheduled_id = "schedule1"; record.event_id = null;
    record.event_channel_id = null; record.post_at = "123";
    const current = { ...event(), id: "schedule1", channelId: "schedule1", postTime: 123, interval: "0 days",
      temporaryRole: undefined as string | undefined };
    mocks.scheduledEvent.mockImplementation(async () => current);
    mocks.scheduled.mockResolvedValue([{ id: "schedule1", channelId: "channel", title: newName, startTime: start, postTime: 123 }]);
    mocks.prepare.mockResolvedValue(null);
    mocks.update.mockImplementation(async () => { current.advancedSettings.temp_role = newName; });
    mocks.query.mockImplementation(async (sql: string) => sql.includes("RETURNING match_number") ? [record] : []);
    await syncGwlEventRole(record, async () => true);
    expect(mocks.rename).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith("schedule1", newName);
  });
});
