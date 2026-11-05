import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: null as import("pg").Client | null, migrationPending: false,
  fixtures: vi.fn(), archive: vi.fn(), names: vi.fn(), create: vi.fn(), scheduled: vi.fn(),
  posted: vi.fn(), raw: vi.fn(), remove: vi.fn(), audit: vi.fn(),
}));
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
    try { const result = await fn(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
  },
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/server/services/wardogsLeague", () => ({ getLeagueFixtures: mocks.fixtures }));
vi.mock("@/server/services/wdlFixtures", () => ({ archiveWdlFixtures: mocks.archive }));
vi.mock("@/server/services/wdlRaidHelper", async (original) => {
  const actual = await original<typeof import("@/server/services/wdlRaidHelper")>();
  return { ...actual, wdlEventNames: mocks.names, createWdlRaidEvent: mocks.create, getScheduledWdlEvents: mocks.scheduled,
    getPostedWdlEvents: mocks.posted, getRawWdlEvent: mocks.raw, deleteWdlRaidEvent: mocks.remove };
});

import { deleteReviewedWdlEvent, disableWdlRaidAutomation, enableWdlRaidAutomation, linkExistingWdlEvent, recoverScheduledWdlEvent, retryReviewedWdlFixture, wdlFixtureTick, wdlRaidStatus } from "@/server/services/wdlRaid";
import type { WdlFixture } from "@/lib/wdlFixtures";

const actor = { discordId: "839225558806167582", displayName: "Owner" };
const productionChannel = "1546479425644793877";
const names = { role: "Wardogs Member", voice: "Briefing", roleNames: [] };
const makeFixture = (id: string, number: number): WdlFixture => ({
  id, number, status: "SCHEDULED", scheduledAt: new Date(Date.now() + 20 * 86400_000).toISOString(),
  map: "Map", gameMode: null, competition: null,
  participants: [
    { team: { code: "RMNT", name: "Remnant" }, faction: null, finishingPosition: null, points: null, noShow: null },
    { team: { code: "WTH", name: "WTH" }, faction: null, finishingPosition: null, points: null, noShow: null },
  ],
});
const snapshot = (upcoming: WdlFixture[]) => ({ data: { upcoming, recent: [] }, stale: false, fetchedAt: new Date().toISOString() });

describe.skipIf(!process.env.TEST_DATABASE_URL)("WDL fixture automation with PostgreSQL", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await mocks.client.connect();
    const migration = await readFile(resolve(process.cwd(), "migrations", "034_wdl_fixtures.sql"), "utf8");
    await mocks.client.query(migration.replace(/CREATE TABLE/g, "CREATE TEMP TABLE"));
    const activation = await readFile(resolve(process.cwd(), "migrations", "035_enable_wdl_automation.sql"), "utf8");
    await mocks.client.query(activation);
    mocks.migrationPending = (await mocks.client.query("SELECT activation_pending FROM wdl_raid_settings")).rows[0].activation_pending;
    await mocks.client.query("UPDATE wdl_raid_settings SET activation_pending = false");
    mocks.fixtures.mockResolvedValue(snapshot([]));
    mocks.archive.mockResolvedValue(undefined);
    mocks.names.mockResolvedValue(names);
    mocks.create.mockResolvedValue({ status: "success", event: { id: "scheduled-id" } });
    mocks.scheduled.mockResolvedValue([]);
    mocks.posted.mockResolvedValue([]);
    mocks.remove.mockResolvedValue(undefined);
    mocks.audit.mockResolvedValue(undefined);
  });
  afterEach(async () => { await mocks.client?.end(); mocks.client = null; });

  it("does not create production events while disabled", async () => {
    mocks.fixtures.mockResolvedValue(snapshot([makeFixture("new", 1)]));
    await wdlFixtureTick();
    expect(mocks.create).not.toHaveBeenCalled();
    expect((await wdlRaidStatus()).enabled).toBe(false);
  });

  it("requests activation when the deployment migration is applied", () => {
    expect(mocks.migrationPending).toBe(true);
  });

  it("activates without a test after baselining a fresh snapshot", async () => {
    const old = makeFixture("old", 1);
    const recent = { ...makeFixture("recent", 2), status: "COMPLETED" };
    mocks.fixtures.mockResolvedValue({ ...snapshot([old]), data: { upcoming: [old], recent: [recent] } });
    await mocks.client!.query("UPDATE wdl_raid_settings SET activation_pending = true");
    await wdlFixtureTick();
    expect(await wdlRaidStatus()).toMatchObject({ enabled: true, activationPending: false, baselineAt: expect.any(String) });
    expect(mocks.create).not.toHaveBeenCalled();
    const rows = (await mocks.client!.query("SELECT fixture_id, state, baseline FROM wdl_fixture_events ORDER BY fixture_id")).rows;
    expect(rows).toEqual([
      { fixture_id: "old", state: "baseline", baseline: true },
      { fixture_id: "recent", state: "baseline", baseline: true },
    ]);
    mocks.fixtures.mockResolvedValue(snapshot([old, makeFixture("new", 3)]));
    await wdlFixtureTick();
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("does not re-baseline new fixtures when re-enabling after a pause", async () => {
    mocks.fixtures.mockResolvedValue(snapshot([makeFixture("old", 1)]));
    await enableWdlRaidAutomation(actor);
    await disableWdlRaidAutomation(actor);
    mocks.fixtures.mockResolvedValue(snapshot([makeFixture("old", 1), makeFixture("new", 2)]));
    await enableWdlRaidAutomation(actor);
    expect((await mocks.client!.query("SELECT fixture_id FROM wdl_fixture_events ORDER BY fixture_id")).rows).toEqual([{ fixture_id: "old" }]);
    await wdlFixtureTick();
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("waits for fresh WDL data before activating and retries on recovery", async () => {
    await mocks.client!.query("UPDATE wdl_raid_settings SET activation_pending = true");
    mocks.fixtures.mockResolvedValueOnce({ ...snapshot([makeFixture("old", 1)]), stale: true, error: "WDL unavailable" })
      .mockResolvedValue(snapshot([makeFixture("old", 1)]));
    await expect(wdlFixtureTick()).rejects.toThrow("WDL unavailable");
    expect(await wdlRaidStatus()).toMatchObject({ enabled: false, activationPending: true, baselineAt: null });
    await wdlFixtureTick();
    expect(await wdlRaidStatus()).toMatchObject({ enabled: true, activationPending: false });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("lets the owner cancel pending activation before a worker can enable it", async () => {
    await mocks.client!.query("UPDATE wdl_raid_settings SET activation_pending = true");
    await disableWdlRaidAutomation(actor);
    mocks.fixtures.mockResolvedValue(snapshot([makeFixture("old", 1)]));
    await wdlFixtureTick();
    expect(await wdlRaidStatus()).toMatchObject({ enabled: false, activationPending: false, baselineAt: null });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not activate if the fixture archive cannot be persisted", async () => {
    await mocks.client!.query("UPDATE wdl_raid_settings SET activation_pending = true");
    mocks.fixtures.mockResolvedValue(snapshot([makeFixture("old", 1)]));
    mocks.archive.mockRejectedValue(new Error("Database unavailable"));
    await expect(wdlFixtureTick()).rejects.toThrow("Database unavailable");
    expect(await wdlRaidStatus()).toMatchObject({ enabled: false, activationPending: true, baselineAt: null });
    expect((await mocks.client!.query("SELECT count(*)::int AS n FROM wdl_fixture_events")).rows[0].n).toBe(0);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refuses manual activation with stale WDL data", async () => {
    mocks.fixtures.mockResolvedValue({ ...snapshot([]), stale: true });
    await expect(enableWdlRaidAutomation(actor)).rejects.toMatchObject({ code: "wdl_stale" });
    expect(await wdlRaidStatus()).toMatchObject({ enabled: false, baselineAt: null });
  });

  it("ignores baselined fixtures and schedules a newly observed one only once", async () => {
    const old = makeFixture("old", 1);
    const fresh = makeFixture("fresh", 2);
    await mocks.client!.query("UPDATE wdl_raid_settings SET enabled = true, baseline_at = now()");
    await mocks.client!.query("INSERT INTO wdl_fixture_events (fixture_id, fixture, baseline, state) VALUES ($1, $2, true, 'baseline')", [old.id, JSON.stringify(old)]);
    mocks.fixtures.mockResolvedValue(snapshot([old, fresh]));
    await wdlFixtureTick();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledWith(productionChannel, expect.objectContaining({ title: "RMNT v WTH", schedule: expect.any(Number) }));
    expect((await mocks.client!.query("SELECT state, scheduled_id FROM wdl_fixture_events WHERE fixture_id = 'fresh'")).rows[0])
      .toEqual({ state: "scheduled", scheduled_id: "scheduled-id" });
    await wdlFixtureTick();
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("flags a possible duplicate rather than posting a second event", async () => {
    const fixture = makeFixture("new", 2);
    await mocks.client!.query("UPDATE wdl_raid_settings SET enabled = true, baseline_at = now()");
    mocks.fixtures.mockResolvedValue(snapshot([fixture]));
    mocks.posted.mockResolvedValue([{ id: "existing", channelId: productionChannel, startTime: Math.floor(Date.parse(fixture.scheduledAt!) / 1000) - 1800 }]);
    await wdlFixtureTick();
    expect((await mocks.client!.query("SELECT state FROM wdl_fixture_events WHERE fixture_id = 'new'")).rows[0].state).toBe("review");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("flags a matching event in another channel and links it only after its briefing time is corrected", async () => {
    const fixture = makeFixture("new", 2);
    const briefing = Math.floor(Date.parse(fixture.scheduledAt!) / 1000) - 1800;
    const otherChannel = "1546184970706616412";
    await mocks.client!.query("UPDATE wdl_raid_settings SET enabled = true, baseline_at = now()");
    mocks.fixtures.mockResolvedValue(snapshot([fixture]));
    mocks.posted.mockResolvedValue([{ id: "existing", channelId: otherChannel, title: "REMNANT v WTH", startTime: briefing + 1800 }]);
    await wdlFixtureTick();
    expect((await mocks.client!.query("SELECT state FROM wdl_fixture_events")).rows[0].state).toBe("review");
    mocks.raw.mockResolvedValue({ id: "existing", serverId: "1332320879073296404", channelId: otherChannel, startTime: briefing + 1800 });
    await expect(linkExistingWdlEvent(fixture.id, "existing", actor)).rejects.toMatchObject({ code: "wdl_wrong_event" });
    mocks.raw.mockResolvedValue({ id: "existing", serverId: "1332320879073296404", channelId: otherChannel, startTime: briefing });
    expect((await linkExistingWdlEvent(fixture.id, "existing", actor)).events[0]).toMatchObject({ state: "posted", eventChannelId: otherChannel });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("verifies an immediately posted event before linking it", async () => {
    const fixture = { ...makeFixture("near", 2), scheduledAt: new Date(Date.now() + 86400_000).toISOString() };
    const briefing = Math.floor(Date.parse(fixture.scheduledAt) / 1000) - 1800;
    await mocks.client!.query("UPDATE wdl_raid_settings SET enabled = true, baseline_at = now()");
    mocks.fixtures.mockResolvedValue(snapshot([fixture]));
    mocks.create.mockResolvedValue({ status: "success", event: { id: "posted-id" } });
    mocks.raw.mockResolvedValue({ id: "posted-id", serverId: "1332320879073296404", channelId: productionChannel,
      templateId: "ct34", startTime: briefing, title: "RMNT v WTH" });
    await wdlFixtureTick();
    expect(mocks.create.mock.calls[0]![1]).not.toHaveProperty("schedule");
    expect((await mocks.client!.query("SELECT state, event_id FROM wdl_fixture_events")).rows[0]).toEqual({ state: "posted", event_id: "posted-id" });
  });

  it("waits rather than scheduling an event moments before its posting time", async () => {
    const now = Math.floor(Date.now() / 1000);
    const clock = vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    try {
      const fixture = { ...makeFixture("near-boundary", 2), scheduledAt: new Date((now + 10 * 86400 + 1800 + 10) * 1000).toISOString() };
      await mocks.client!.query("UPDATE wdl_raid_settings SET enabled = true, baseline_at = now()");
      mocks.fixtures.mockResolvedValue(snapshot([fixture]));
      await wdlFixtureTick();
      expect(mocks.create).not.toHaveBeenCalled();
      clock.mockReturnValue((now + 11) * 1000);
      mocks.create.mockResolvedValue({ status: "success", event: { id: "posted-id" } });
      mocks.raw.mockResolvedValue({ id: "posted-id", serverId: "1332320879073296404", channelId: productionChannel,
        templateId: "ct34", startTime: Math.floor(Date.parse(fixture.scheduledAt) / 1000) - 1800, title: "RMNT v WTH" });
      await wdlFixtureTick();
      expect(mocks.create.mock.calls[0]![1]).not.toHaveProperty("schedule");
    } finally {
      clock.mockRestore();
    }
  });

  it("keeps an immediately posted event uncertain if the returned event does not match", async () => {
    const fixture = { ...makeFixture("near", 2), scheduledAt: new Date(Date.now() + 86400_000).toISOString() };
    await mocks.client!.query("UPDATE wdl_raid_settings SET enabled = true, baseline_at = now()");
    mocks.fixtures.mockResolvedValue(snapshot([fixture]));
    mocks.create.mockResolvedValue({ status: "success", event: { id: "posted-id" } });
    mocks.raw.mockResolvedValue({ id: "posted-id", serverId: "1332320879073296404", channelId: "wrong",
      templateId: "ct34", startTime: 0, title: "Unexpected" });
    await expect(wdlFixtureTick()).rejects.toThrow("could not be confirmed");
    expect((await mocks.client!.query("SELECT state FROM wdl_fixture_events")).rows[0].state).toBe("uncertain");
  });

  it("rechecks WDL after preflight and does not create an event using a changed fixture", async () => {
    const fixture = makeFixture("new", 2);
    await mocks.client!.query("UPDATE wdl_raid_settings SET enabled = true, baseline_at = now()");
    mocks.fixtures.mockResolvedValueOnce(snapshot([fixture])).mockResolvedValueOnce(snapshot([{ ...fixture, map: "Changed map" }]));
    await wdlFixtureTick();
    expect(mocks.create).not.toHaveBeenCalled();
    expect((await mocks.client!.query("SELECT state, fixture, error FROM wdl_fixture_events")).rows[0])
      .toMatchObject({ state: "pending", fixture: { map: "Changed map" }, error: expect.stringContaining("changed while") });
  });

  it("reserves temporary role names for future events before the roles exist in Discord", async () => {
    const first = makeFixture("first", 1);
    const second = { ...makeFixture("second", 2), scheduledAt: new Date(Date.parse(first.scheduledAt!) + 3600_000).toISOString() };
    await mocks.client!.query("UPDATE wdl_raid_settings SET enabled = true, baseline_at = now()");
    mocks.fixtures.mockResolvedValue(snapshot([first]));
    await wdlFixtureTick();
    expect(mocks.create.mock.calls[0]![1].advancedSettings.temp_role).toBe("RMNT v WTH");
    mocks.fixtures.mockResolvedValue(snapshot([first, second]));
    mocks.create.mockResolvedValue({ status: "success", event: { id: "second-schedule" } });
    await wdlFixtureTick();
    expect(mocks.create.mock.calls[1]![1].advancedSettings.temp_role).toBe("RMNT v WTH #2");
  });

  it("releases a finished role reservation only when the role no longer exists", async () => {
    const old = { ...makeFixture("old", 1), scheduledAt: new Date(Date.now() - 48 * 3600_000).toISOString() };
    const fresh = makeFixture("fresh", 2);
    await mocks.client!.query("UPDATE wdl_raid_settings SET enabled = true, baseline_at = now()");
    await mocks.client!.query(
      "INSERT INTO wdl_fixture_events (fixture_id, fixture, state, temporary_role) VALUES ($1, $2, 'posted', 'RMNT v WTH')",
      [old.id, JSON.stringify(old)],
    );
    mocks.fixtures.mockResolvedValue(snapshot([fresh]));
    await wdlFixtureTick();
    expect(mocks.create.mock.calls[0]![1].advancedSettings.temp_role).toBe("RMNT v WTH");
    expect((await mocks.client!.query("SELECT temporary_role FROM wdl_fixture_events WHERE fixture_id = 'old'")).rows[0].temporary_role).toBeNull();
  });

  it("does not blindly retry when an automatic create has an uncertain outcome", async () => {
    await mocks.client!.query("UPDATE wdl_raid_settings SET enabled = true, baseline_at = now()");
    mocks.fixtures.mockResolvedValue(snapshot([makeFixture("new", 2)]));
    mocks.create.mockRejectedValue(new Error("network timeout"));
    await expect(wdlFixtureTick()).rejects.toThrow("could not be confirmed");
    expect((await mocks.client!.query("SELECT state FROM wdl_fixture_events")).rows[0].state).toBe("uncertain");
    await wdlFixtureTick();
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("flags changed fixtures instead of overwriting an unverified Raid Helper event", async () => {
    const fixture = makeFixture("new", 2);
    await mocks.client!.query("UPDATE wdl_raid_settings SET enabled = true, baseline_at = now()");
    mocks.fixtures.mockResolvedValue(snapshot([fixture]));
    await wdlFixtureTick();
    mocks.fixtures.mockResolvedValue(snapshot([{ ...fixture, map: "Changed map" }]));
    await wdlFixtureTick();
    expect((await mocks.client!.query("SELECT state, error FROM wdl_fixture_events")).rows[0])
      .toMatchObject({ state: "review", error: expect.stringContaining("WDL changed") });
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("flags a scheduled event when its role or voice channel is renamed", async () => {
    const fixture = makeFixture("new", 2);
    await mocks.client!.query("UPDATE wdl_raid_settings SET enabled = true, baseline_at = now()");
    mocks.fixtures.mockResolvedValue(snapshot([fixture]));
    await wdlFixtureTick();
    mocks.names.mockResolvedValue({ ...names, role: "Renamed Member" });
    await wdlFixtureTick();
    expect((await mocks.client!.query("SELECT state, error FROM wdl_fixture_events")).rows[0])
      .toMatchObject({ state: "review", error: expect.stringContaining("may still post with the old names") });
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("does not flag a fixture merely because WDL changed participant order", async () => {
    const fixture = makeFixture("new", 2);
    await mocks.client!.query("UPDATE wdl_raid_settings SET enabled = true, baseline_at = now()");
    mocks.fixtures.mockResolvedValue(snapshot([fixture]));
    await wdlFixtureTick();
    mocks.fixtures.mockResolvedValue(snapshot([{ ...fixture, participants: [...fixture.participants].reverse() }]));
    await wdlFixtureTick();
    expect((await mocks.client!.query("SELECT state FROM wdl_fixture_events")).rows[0].state).toBe("scheduled");
  });

  it("reconciles a scheduled production event only when its scheduled ID and posted details match", async () => {
    const fixture = makeFixture("new", 2);
    await mocks.client!.query("UPDATE wdl_raid_settings SET enabled = true, baseline_at = now()");
    mocks.fixtures.mockResolvedValue(snapshot([fixture]));
    await wdlFixtureTick();
    const sent = mocks.create.mock.calls[0]![1];
    mocks.posted.mockResolvedValue([{ id: "posted", channelId: productionChannel, title: sent.title, startTime: Number(sent.date), scheduledId: "scheduled-id" }]);
    mocks.raw.mockResolvedValue({ id: "posted", serverId: "1332320879073296404", channelId: productionChannel,
      templateId: "ct34", startTime: Number(sent.date), scheduledId: "scheduled-id", title: sent.title });
    await wdlFixtureTick();
    expect((await mocks.client!.query("SELECT state, event_id FROM wdl_fixture_events")).rows[0]).toEqual({ state: "posted", event_id: "posted" });
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("recovers an uncertain scheduled fixture without sending another create", async () => {
    const fixture = makeFixture("new", 2);
    const start = Math.floor(Date.parse(fixture.scheduledAt!) / 1000) - 1800;
    await mocks.client!.query(
      "INSERT INTO wdl_fixture_events (fixture_id, fixture, state, start_time) VALUES ($1, $2, 'uncertain', $3)",
      [fixture.id, JSON.stringify(fixture), start],
    );
    mocks.fixtures.mockResolvedValue(snapshot([fixture]));
    mocks.scheduled.mockResolvedValue([{ id: "recovered", channelId: productionChannel, title: "RMNT v WTH", startTime: start, postTime: start - 10 * 86400 }]);
    const result = await recoverScheduledWdlEvent("new", "recovered", actor);
    expect(result.events[0]).toMatchObject({ state: "scheduled", scheduledId: "recovered" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("only retries reviewed fixtures after checking WDL and both Raid Helper event lists", async () => {
    const fixture = makeFixture("new", 2);
    await mocks.client!.query("INSERT INTO wdl_fixture_events (fixture_id, fixture, state) VALUES ($1, $2, 'review')", [fixture.id, JSON.stringify(fixture)]);
    mocks.fixtures.mockResolvedValue(snapshot([fixture]));
    mocks.posted.mockResolvedValue([{ id: "existing", channelId: productionChannel, title: "Existing", startTime: Math.floor(Date.parse(fixture.scheduledAt!) / 1000) - 1800 }]);
    await expect(retryReviewedWdlFixture(fixture.id, actor)).rejects.toMatchObject({ code: "wdl_possible_duplicate" });
    expect((await mocks.client!.query("SELECT state FROM wdl_fixture_events")).rows[0].state).toBe("review");
    mocks.posted.mockResolvedValue([]);
    await retryReviewedWdlFixture(fixture.id, actor);
    expect((await mocks.client!.query("SELECT state FROM wdl_fixture_events")).rows[0].state).toBe("pending");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not link one Raid Helper event to two fixtures", async () => {
    const first = makeFixture("first", 1);
    const second = { ...makeFixture("second", 2), scheduledAt: first.scheduledAt };
    await mocks.client!.query("INSERT INTO wdl_fixture_events (fixture_id, fixture, state) VALUES ($1, $2, 'review'), ($3, $4, 'review')",
      [first.id, JSON.stringify(first), second.id, JSON.stringify(second)]);
    mocks.fixtures.mockResolvedValue(snapshot([first, second]));
    mocks.raw.mockResolvedValue({ id: "event1", serverId: "1332320879073296404", channelId: productionChannel,
      startTime: Math.floor(Date.parse(first.scheduledAt!) / 1000) - 1800 });
    await linkExistingWdlEvent("first", "event1", actor);
    await expect(linkExistingWdlEvent("second", "event1", actor)).rejects.toMatchObject({ code: "wdl_event_linked" });
  });

  it("waits for missing opponent data and can schedule once it becomes complete", async () => {
    const complete = makeFixture("new", 2);
    const incomplete = { ...complete, participants: complete.participants.slice(0, 1) };
    await mocks.client!.query("UPDATE wdl_raid_settings SET enabled = true, baseline_at = now()");
    mocks.fixtures.mockResolvedValue(snapshot([incomplete]));
    await wdlFixtureTick();
    expect((await mocks.client!.query("SELECT state FROM wdl_fixture_events")).rows[0].state).toBe("waiting");
    mocks.fixtures.mockResolvedValue(snapshot([complete]));
    await wdlFixtureTick();
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("links or explicitly deletes a reviewed event only after checking its guild and channel", async () => {
    const fixture = makeFixture("new", 2);
    await mocks.client!.query("INSERT INTO wdl_fixture_events (fixture_id, fixture, state) VALUES ($1, $2, 'review')", [fixture.id, JSON.stringify(fixture)]);
    mocks.fixtures.mockResolvedValue(snapshot([fixture]));
    mocks.raw.mockResolvedValue({ id: "event1", serverId: "1332320879073296404", channelId: productionChannel,
      startTime: Math.floor(Date.parse(fixture.scheduledAt!) / 1000) - 1800 });
    await linkExistingWdlEvent("new", "event1", actor);
    expect((await mocks.client!.query("SELECT event_id FROM wdl_fixture_events")).rows[0].event_id).toBe("event1");
    await mocks.client!.query("UPDATE wdl_fixture_events SET state = 'review'");
    await deleteReviewedWdlEvent("new", actor);
    expect(mocks.remove).toHaveBeenCalledWith("event1");
    expect((await mocks.client!.query("SELECT state FROM wdl_fixture_events")).rows[0].state).toBe("cancelled");
  });
});
