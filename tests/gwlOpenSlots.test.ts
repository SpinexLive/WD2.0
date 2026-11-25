import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GwlFixture, GwlSlot } from "@/server/services/gwl";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), slots: vi.fn(), fixtures: vi.fn(), team: vi.fn(), audit: vi.fn(),
  raw: vi.fn(), scheduled: vi.fn(), scheduledEvent: vi.fn(), update: vi.fn(), remove: vi.fn(), channel: vi.fn(),
  prepareRole: vi.fn(), renameRole: vi.fn(), verifyRole: vi.fn(), verifyAbsent: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ env: () => ({ APP_URL: "https://dashboard.test", DISCORD_GUILD_ID: "guild" }) }));
vi.mock("@/lib/db", () => ({ query: mocks.query, independentQuery: mocks.query }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/server/services/gwl", async (original) => {
  const actual = await original<typeof import("@/server/services/gwl")>();
  return { ...actual, getGwlSlots: mocks.slots, getGwlFixtures: mocks.fixtures, getGwlTeam: mocks.team };
});
vi.mock("@/server/services/leagueRaidHelper", () => ({
  LEAGUE_EVENT_CHANNEL: "channel", getRawLeagueEvent: mocks.raw,
  getScheduledLeagueEvents: mocks.scheduled, getScheduledLeagueEvent: mocks.scheduledEvent,
  updateLeagueEvent: mocks.update, deleteLeagueRaidEvent: mocks.remove,
  prepareLeagueRoleRename: mocks.prepareRole, renameLeagueRole: mocks.renameRole,
  verifyLeagueRoleRename: mocks.verifyRole, verifyLeagueRoleAbsent: mocks.verifyAbsent,
  otherLeagueSettingsUnchanged: () => true,
  isLeagueEventChannel: mocks.channel,
}));

import { processOpenSlots } from "@/server/services/gwlOpenSlots";
import { gwlEventBody, matchesOpenSlot, openSlotEventBody, openSlotFixture, slotFingerprint } from "@/server/services/gwlRaidHelper";
import { ProviderError } from "@/lib/http";

const slot: GwlSlot = { id: "slot-1", startsAt: "2035-01-21T19:30:00Z", region: "EU", map: "europe",
  layer: null, weather: null, seatsFilled: 2, host: "other", joinedTeam: "remnant" };
const team = { slug: "remnant", tag: "RMNT" };
const open = openSlotFixture(slot, team);
const side = (slug: string, tag: string) => ({ team: { slug, tag, name: tag }, faction: null, score: null,
  points: null, placement: null, eloDelta: null });
const match: GwlFixture = { number: "42", status: "scheduled", startsAt: slot.startsAt, region: "EU",
  map: "europe", layer: null, weather: null, sides: [side("other", "OTH"), side("remnant", "RMNT"), side("third", "THD")] };
const names = { role: "Member", voice: "Briefing", roleNames: [] };
const body = openSlotEventBody(open, names, 0);
const legacyOpen = (presentationVersion: number | undefined = 3) => ({
  ...open,
  sides: open.sides.map((entry) => entry.team.slug.startsWith("__tbd")
    ? { ...entry, team: { ...entry.team, tag: "TBD" } }
    : entry),
  presentationVersion,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.audit.mockResolvedValue(undefined);
  mocks.prepareRole.mockImplementation(async (_id, _old, _next, scheduled) => scheduled ? null : "role");
  mocks.renameRole.mockResolvedValue(undefined);
  mocks.verifyRole.mockResolvedValue(undefined);
  mocks.verifyAbsent.mockResolvedValue(undefined);
  mocks.channel.mockResolvedValue(true);
  mocks.team.mockResolvedValue({ stale: false, data: team });
  mocks.slots.mockResolvedValue({ stale: false, data: { slots: [] } });
  mocks.fixtures.mockResolvedValue({ stale: false, data: { upcoming: [], recent: [] } });
});

describe("GWL open slots", () => {
  it("creates ??? payloads for one or two teams using existing scheduling settings", () => {
    const single = openSlotFixture({ ...slot, host: "remnant", joinedTeam: null, seatsFilled: 1 }, team);
    expect(openSlotEventBody(single, names, 0).title).toBe("GWL | RMNT v ??? v ???");
    expect(body.title).toBe("GWL | RMNT v other v ???");
    for (const fixture of [single, open]) {
      const event = openSlotEventBody(fixture, names, 0);
      expect(event.title).toContain("???");
      expect(event.description).toContain("**Status:** ??? — awaiting third team");
      expect(event.description).toContain("??? (???)");
      expect(event.description).not.toContain("**Open slot:**");
      expect(event.description).not.toContain("TBD");
      expect(event.templateId).toBe("ct34");
      expect(Number(event.date)).toBe(Date.parse(slot.startsAt) / 1000 - 1800);
      expect(event.schedule).toBe(Date.parse(slot.startsAt) / 1000 - 12 * 86400);
      expect(event.advancedSettings.allowed_roles).toBe("Member");
    }
    expect(() => openSlotFixture({ ...slot, joinedTeam: null }, team)).toThrow();
    expect(matchesOpenSlot(open, match)).toBe(true);
    expect(matchesOpenSlot(open, { ...match, sides: [side("different", "DIF"), match.sides[1]!, match.sides[2]!] })).toBe(false);
    expect(slotFingerprint({ ...slot })).toBe(slotFingerprint({ joinedTeam: slot.joinedTeam, host: slot.host,
      seatsFilled: slot.seatsFilled, weather: slot.weather, layer: slot.layer, map: slot.map,
      region: slot.region, startsAt: slot.startsAt, id: slot.id }));
  });

  it("uses unambiguous team tags from fixture history and updates a legacy event without losing signups", async () => {
    const legacy = legacyOpen(0);
    const oldBody = openSlotEventBody(legacy, names, 0);
    const oldDescription = oldBody.description.replace("**Status:** TBD — awaiting teams",
      `**Open slot:** ${slot.id}\n**Status:** TBD — awaiting teams`);
    const row = { match_number: open.number, fixture: legacy, state: "posted", scheduled_id: null, event_id: "event1",
      event_channel_id: "thread", start_time: oldBody.date, post_at: null, temporary_role: oldBody.title,
      member_role_name: "Member", voice_channel_name: "Briefing", error: null };
    const event = { id: "event1", serverId: "guild", channelId: "thread", templateId: "ct34",
      title: oldBody.title, startTime: Number(oldBody.date), description: oldDescription, signUps: [{ id: 1, userId: "player" }],
      advancedSettings: { temp_role: oldBody.title }, temporaryRole: "role" };
    mocks.slots.mockResolvedValue({ stale: false, data: { slots: [slot] } });
    mocks.raw.mockResolvedValue(event);
    mocks.update.mockImplementation(async (_id, changes) => { mocks.raw.mockResolvedValue({ ...event, ...changes, temporaryRole: "role" }); });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT *")) return [row];
      if (sql.includes("RETURNING match_number")) return [row];
      return [];
    });
    await processOpenSlots([], [match]);
    expect(mocks.update).toHaveBeenCalledWith("event1", expect.objectContaining({
      title: "GWL | RMNT v OTH v ???",
      description: expect.stringContaining("**Status:** ??? — awaiting third team"),
    }));
    expect(mocks.update.mock.calls[0]?.[1].description).not.toContain("TBD");
    expect(mocks.update.mock.calls[0]?.[1].description).not.toContain("**Open slot:**");
    expect(mocks.raw).toHaveBeenCalledTimes(4);
  });

  it("uses current slot tags and display names to update a previously posted event", async () => {
      const old = legacyOpen(3);
      const oldBody = openSlotEventBody(old, names, 0);
      const row = { match_number: open.number, fixture: old, state: "posted", scheduled_id: null, event_id: "event1",
        event_channel_id: "thread", start_time: oldBody.date, post_at: null, temporary_role: oldBody.title,
        member_role_name: "Member", voice_channel_name: "Briefing", error: null };
      const event = { id: "event1", serverId: "guild", channelId: "thread", templateId: "ct34",
        title: oldBody.title, startTime: Number(oldBody.date), description: oldBody.description, signUps: [{ id: 1, userId: "player" }],
        advancedSettings: { temp_role: oldBody.title }, temporaryRole: "role" };
      const current = { ...slot, mapName: "Ozeti", zone: "Random zone", seatsFree: 1, yours: true, private: false,
        teams: [{ slug: "other", name: "Other", tag: "OTH" }, { slug: "remnant", name: "Remnant", tag: "RMNT" }] };
      mocks.slots.mockResolvedValue({ stale: false, data: { slots: [current] } });
      mocks.raw.mockResolvedValue(event);
      mocks.update.mockImplementation(async (_id, changes) => { mocks.raw.mockResolvedValue({ ...event, ...changes, temporaryRole: "role" }); });
      mocks.query.mockImplementation(async (sql: string) => {
        if (sql.startsWith("SELECT *")) return [row];
        if (sql.includes("RETURNING match_number")) return [row];
        return [];
      });

      await processOpenSlots([], [{ ...match, sides: [side("other", "OLD"), match.sides[1]!, match.sides[2]!] }]);
      expect(mocks.update).toHaveBeenCalledWith("event1", expect.objectContaining({
        title: "GWL | RMNT v OTH v ???",
        description: expect.stringContaining("**Map:** Ozeti\n**Zone:** Random zone"),
      }));
      expect(mocks.raw).toHaveBeenCalledTimes(4);
  });

  it("updates existing scheduled TBD events to ??? in both title and description", async () => {
    const old = legacyOpen(3);
    const oldBody = openSlotEventBody(old, names, 0);
    const row = { match_number: open.number, fixture: old, state: "scheduled", scheduled_id: "schedule1", event_id: null,
      event_channel_id: null, start_time: oldBody.date, post_at: String(oldBody.schedule), temporary_role: oldBody.title,
      member_role_name: "Member", voice_channel_name: "Briefing", error: null };
    const entry = { id: "schedule1", channelId: "channel", title: oldBody.title, startTime: Number(oldBody.date), postTime: oldBody.schedule };
    const event = { serverId: "guild", channelId: "schedule1", title: oldBody.title, templateId: "ct34",
      startTime: Number(oldBody.date), postTime: oldBody.schedule, interval: "0 days", description: oldBody.description,
      advancedSettings: { temp_role: oldBody.title } };
    mocks.slots.mockResolvedValue({ stale: false, data: { slots: [slot] } });
    mocks.scheduled.mockResolvedValue([entry]);
    mocks.scheduledEvent.mockResolvedValue(event);
    mocks.update.mockImplementation(async (_id, changes) => {
      mocks.scheduled.mockResolvedValue([{ ...entry, title: changes.title }]);
      mocks.scheduledEvent.mockResolvedValue({ ...event, ...changes });
    });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT *")) return [row];
      if (sql.includes("RETURNING match_number")) return [row];
      return [];
    });
    await processOpenSlots([]);
    expect(mocks.update).toHaveBeenCalledWith("schedule1", expect.objectContaining({
      title: "GWL | RMNT v other v ???",
      description: expect.stringContaining("**Status:** ??? — awaiting third team"),
    }));
    expect(mocks.update.mock.calls[0]?.[1].description).not.toContain("TBD");
  });

  it("does not update an event if the slot tag changes during the fresh check", async () => {
      const old = legacyOpen(3);
      const oldBody = openSlotEventBody(old, names, 0);
      const row = { match_number: open.number, fixture: old, state: "posted", scheduled_id: null, event_id: "event1",
        event_channel_id: "thread", start_time: oldBody.date, post_at: null, temporary_role: oldBody.title,
        member_role_name: "Member", voice_channel_name: "Briefing", error: null };
      const current = { ...slot, teams: [{ slug: "other", name: "Other", tag: "OTH" }, { slug: "remnant", name: "Remnant", tag: "RMNT" }] };
      const changed = { ...current, teams: [{ slug: "other", name: "Other", tag: "NEW" }, current.teams[1]!] };
      mocks.slots.mockResolvedValueOnce({ stale: false, data: { slots: [current] } })
        .mockResolvedValueOnce({ stale: false, data: { slots: [changed] } });
      mocks.raw.mockResolvedValue({ id: "event1", serverId: "guild", channelId: "thread", templateId: "ct34",
        title: oldBody.title, startTime: Number(oldBody.date), description: oldBody.description, signUps: [] });
      mocks.query.mockImplementation(async (sql: string) => sql.startsWith("SELECT *") ? [row] : []);
      await processOpenSlots([]);
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("state = 'review'"), expect.arrayContaining([open.number]));
  });

  it("restores and updates a temporarily missing slot when it returns with a new tag", async () => {
    const old = legacyOpen(3);
    const oldBody = openSlotEventBody(old, names, 0);
    const row = { match_number: open.number, fixture: old, state: "review", scheduled_id: null, event_id: "event1",
      event_channel_id: "thread", start_time: oldBody.date, post_at: null, temporary_role: oldBody.title,
      member_role_name: "Member", voice_channel_name: "Briefing",
      error: "GWL open slot is missing; waiting for a second fresh check before removal." };
    const current = { ...slot, teams: [{ slug: "other", name: "Other", tag: "OTH" }, { slug: "remnant", name: "Remnant", tag: "RMNT" }] };
    const event = { id: "event1", serverId: "guild", channelId: "thread", templateId: "ct34",
      title: oldBody.title, startTime: Number(oldBody.date), description: oldBody.description, signUps: [],
      advancedSettings: { temp_role: oldBody.title }, temporaryRole: "role" };
    mocks.slots.mockResolvedValue({ stale: false, data: { slots: [current] } });
    mocks.raw.mockResolvedValue(event);
    mocks.update.mockImplementation(async (_id, changes) => { mocks.raw.mockResolvedValue({ ...event, ...changes, temporaryRole: "role" }); });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT *")) return [row];
      if (sql.includes("RETURNING match_number")) return [row];
      return [];
    });
    await processOpenSlots([]);
    expect(mocks.update).toHaveBeenCalledWith("event1", expect.objectContaining({ title: "GWL | RMNT v OTH v ???" }));
  });

  it("does not guess between conflicting historical team tags", async () => {
    mocks.slots.mockResolvedValue({ stale: false, data: { slots: [slot] } });
    mocks.query.mockResolvedValue([]);
    const changed = { ...match, sides: [side("other", "DIFF"), match.sides[1]!, match.sides[2]!] };
    await processOpenSlots([], [match, changed]);
    const insert = mocks.query.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("VALUES ($1, $2, 'pending')"));
    expect(JSON.parse(insert![1][1]).sides[0].team.tag).toBe("other");
  });

  it("creates a pending row for an open slot and blocks overlap with a visible match", async () => {
    mocks.slots.mockResolvedValue({ stale: false, data: { slots: [slot] } });
    mocks.query.mockResolvedValue([]);
    await processOpenSlots([]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("VALUES ($1, $2, 'pending')"), expect.arrayContaining([open.number]));
    mocks.query.mockClear();
    expect(await processOpenSlots([match])).toEqual(new Set(["42"]));
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("VALUES ($1, $2, 'review'"), expect.arrayContaining([open.number]));
  });

  it("turns a vanished match event back into the reopened slot event and keeps its signups", async () => {
    const matchBody = gwlEventBody(match, names, 0);
    const row = { match_number: "42", fixture: match, state: "posted", scheduled_id: null, event_id: "event1",
      event_channel_id: "thread", start_time: matchBody.date, post_at: null, temporary_role: matchBody.title,
      member_role_name: "Member", voice_channel_name: "Briefing", error: null };
    const event = { id: "event1", serverId: "guild", channelId: "thread", templateId: "ct34", title: matchBody.title,
      startTime: Number(matchBody.date), description: matchBody.description, signUps: [{ id: 1, userId: "player" }],
      advancedSettings: { temp_role: matchBody.title }, temporaryRole: "role" };
    mocks.slots.mockResolvedValue({ stale: false, data: { slots: [slot] } });
    mocks.raw.mockResolvedValue(event);
    mocks.update.mockImplementation(async (_id, changes) => { mocks.raw.mockResolvedValue({ ...event, ...changes, temporaryRole: "role" }); });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("NOT LIKE 'slot:%'")) return [row];
      if (sql.includes("RETURNING match_number")) return [{ match_number: open.number }];
      return [];
    });
    await processOpenSlots([]);
    expect(mocks.update).toHaveBeenCalledWith("event1", expect.objectContaining({ title: body.title, description: body.description }));
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalledWith(expect.stringContaining("VALUES ($1, $2, 'pending')"), expect.anything());
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), "gwl.match_reopened", "gwl_slot", slot.id, expect.anything());
  });

  it("flags ambiguous matches and never updates or deletes the event", async () => {
    const row = { match_number: open.number, fixture: open, state: "posted", error: null };
    mocks.query.mockImplementation(async (sql: string) => sql.startsWith("SELECT *") ? [row] : []);
    expect(await processOpenSlots([match, { ...match, number: "43" }])).toEqual(new Set(["42", "43"]));
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("state = 'review'"), expect.arrayContaining([open.number]));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("flags a nearby match with a changed time rather than treating the slot as withdrawn", async () => {
    const row = { match_number: open.number, fixture: open, state: "posted", error: null };
    mocks.query.mockImplementation(async (sql: string) => sql.startsWith("SELECT *") ? [row] : []);
    const shifted = { ...match, startsAt: "2035-01-21T20:30:00Z" };
    expect(await processOpenSlots([shifted])).toEqual(new Set(["42"]));
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("state = 'review'"), expect.arrayContaining([open.number]));
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("updates the existing posted event for a unique match and verifies signups", async () => {
    const previousRoleName = body.title.replace("???", "TBD");
    const row = { match_number: open.number, fixture: open, state: "posted", scheduled_id: null, event_id: "event1",
      event_channel_id: "thread", start_time: body.date, post_at: null, temporary_role: body.title,
      member_role_name: "Member", voice_channel_name: "Briefing", error: null };
    const event = { id: "event1", serverId: "guild", channelId: "thread", templateId: "ct34",
      title: body.title, startTime: Number(body.date), description: body.description, signUps: [{ id: 1, userId: "player" }],
      advancedSettings: { temp_role: previousRoleName }, temporaryRole: "role" };
    mocks.fixtures.mockResolvedValue({ stale: false, data: { upcoming: [match], recent: [] } });
    mocks.raw.mockResolvedValue(event);
    mocks.update.mockImplementation(async (_id, changes) => { mocks.raw.mockResolvedValue({ ...event, ...changes, temporaryRole: "role" }); });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT *")) return [row];
      if (sql.startsWith("SELECT match_number")) return [];
      if (sql.includes("RETURNING match_number")) return [{ match_number: "42" }];
      return [];
    });
    expect(await processOpenSlots([match])).toEqual(new Set());
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledWith("event1", expect.objectContaining({ title: "GWL | RMNT v OTH v THD" }));
    expect(mocks.raw).toHaveBeenCalledTimes(4);
    expect(mocks.prepareRole).toHaveBeenCalledWith("event1", previousRoleName, "GWL | RMNT v OTH v THD", false, body.title);
    expect(mocks.renameRole).toHaveBeenCalledWith("role", previousRoleName, "GWL | RMNT v OTH v THD");
    expect(mocks.update).toHaveBeenCalledWith("event1", expect.objectContaining({
      advancedSettings: { temp_role: "GWL | RMNT v OTH v THD" },
    }));
  });

  it("leaves an unconfirmed update uncertain and does not retry it", async () => {
    const row = { match_number: open.number, fixture: open, state: "posted", scheduled_id: null, event_id: "event1",
      event_channel_id: "thread", start_time: body.date, post_at: null, temporary_role: body.title,
      member_role_name: "Member", voice_channel_name: "Briefing", error: null as string | null };
    mocks.fixtures.mockResolvedValue({ stale: false, data: { upcoming: [match], recent: [] } });
    mocks.raw.mockResolvedValue({ id: "event1", serverId: "guild", channelId: "thread", templateId: "ct34",
      title: body.title, startTime: Number(body.date), description: body.description, signUps: [],
      advancedSettings: { temp_role: body.title }, temporaryRole: "role" });
    mocks.update.mockRejectedValue(new Error("timeout"));
    mocks.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.startsWith("SELECT *")) return [row];
      if (sql.includes("SET state = 'uncertain'")) { row.state = "uncertain"; row.error = values[2] as string; return [row]; }
      return [];
    });
    await expect(processOpenSlots([match])).rejects.toThrow("could not be confirmed");
    await processOpenSlots([match]);
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(row.state).toBe("uncertain");
  });

  it("deletes a verified withdrawn posted event after a second check and confirms 404", async () => {
    const row = { match_number: open.number, fixture: open, state: "review", scheduled_id: null, event_id: "event1",
      event_channel_id: "thread", start_time: body.date, post_at: null, temporary_role: body.title,
      member_role_name: "Member", voice_channel_name: "Briefing",
      error: "GWL open slot is missing; waiting for a second fresh check before removal.", updated_at: new Date(Date.now() - 61_000) };
    const event = { id: "event1", serverId: "guild", channelId: "thread", templateId: "ct34",
      title: body.title, startTime: Number(body.date), description: body.description, signUps: [] };
    mocks.raw.mockResolvedValueOnce(event).mockResolvedValueOnce(event).mockRejectedValueOnce(new ProviderError("raid-helper", "Not found", 404));
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT *")) return [row];
      if (sql.includes("RETURNING match_number")) return [row];
      return [];
    });
    await processOpenSlots([]);
    expect(mocks.remove).toHaveBeenCalledWith("event1");
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("SET state = 'cancelled'"), expect.any(Array));
  });

  it("updates a verified nonrecurring schedule when a match locks", async () => {
    const row = { match_number: open.number, fixture: open, state: "scheduled", scheduled_id: "schedule1", event_id: null,
      event_channel_id: null, start_time: body.date, post_at: String(body.schedule), temporary_role: body.title,
      member_role_name: "Member", voice_channel_name: "Briefing", error: null };
    const entry = { id: "schedule1", channelId: "channel", title: body.title, startTime: Number(body.date), postTime: body.schedule };
    const event = { serverId: "guild", channelId: "schedule1", title: body.title, templateId: "ct34",
      startTime: Number(body.date), postTime: body.schedule, interval: "0 days", description: body.description,
      advancedSettings: { temp_role: body.title } };
    mocks.fixtures.mockResolvedValue({ stale: false, data: { upcoming: [match], recent: [] } });
    mocks.scheduled.mockResolvedValue([entry]);
    mocks.scheduledEvent.mockResolvedValue(event);
    mocks.update.mockImplementation(async (_id, changes) => {
      mocks.scheduled.mockResolvedValue([{ ...entry, title: changes.title }]);
      mocks.scheduledEvent.mockResolvedValue({ ...event, ...changes });
    });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT *")) return [row];
      if (sql.includes("RETURNING match_number")) return [row];
      return [];
    });
    expect(await processOpenSlots([match])).toEqual(new Set());
    expect(mocks.update).toHaveBeenCalledWith("schedule1", expect.objectContaining({ title: "GWL | RMNT v OTH v THD" }));
  });

  it("deletes a verified nonrecurring schedule only after fresh checks and a 404", async () => {
    const row = { match_number: open.number, fixture: open, state: "review", scheduled_id: "schedule1", event_id: null,
      event_channel_id: null, start_time: body.date, post_at: String(body.schedule), temporary_role: body.title,
      member_role_name: "Member", voice_channel_name: "Briefing",
      error: "GWL open slot is missing; waiting for a second fresh check before removal.", updated_at: new Date(Date.now() - 61_000) };
    const entry = { id: "schedule1", channelId: "channel", title: body.title, startTime: Number(body.date), postTime: body.schedule };
    const event = { serverId: "guild", channelId: "schedule1", title: body.title, templateId: "ct34",
      startTime: Number(body.date), postTime: body.schedule, interval: "0 days", description: body.description };
    mocks.scheduled.mockResolvedValueOnce([entry]).mockResolvedValueOnce([entry]).mockResolvedValueOnce([]);
    mocks.scheduledEvent.mockResolvedValueOnce(event).mockResolvedValueOnce(event)
      .mockRejectedValueOnce(new ProviderError("raid-helper", "Not found", 404));
    mocks.query.mockImplementation(async (sql: string) => sql.startsWith("SELECT *") || sql.includes("RETURNING match_number") ? [row] : []);
    await processOpenSlots([]);
    expect(mocks.remove).toHaveBeenCalledWith("schedule1");
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("SET state = 'cancelled'"), expect.any(Array));
  });

  it("does not mutate when a match already has a record or fresh data is stale", async () => {
    const row = { match_number: open.number, fixture: open, state: "posted", error: null };
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT *")) return [row];
      if (sql.startsWith("SELECT match_number")) return [{ match_number: match.number }];
      return [];
    });
    expect(await processOpenSlots([match])).toEqual(new Set(["42"]));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("state = 'review'"), expect.arrayContaining([open.number]));
    mocks.slots.mockResolvedValue({ stale: true, error: "slots unavailable", data: { slots: [] } });
    await expect(processOpenSlots([])).rejects.toThrow("slots unavailable");
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
