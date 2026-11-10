import { audit } from "@/lib/audit";
import { independentQuery, query, withLeagueEventLock } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { getGwlFixtures, type GwlFixture } from "./gwl";
import { gwlEventBody } from "./gwlRaidHelper";
import { createWdlRaidEvent, getPostedWdlEvents, getRawWdlEvent, getScheduledWdlEvents, wdlEventNames, WDL_EVENT_CHANNEL } from "./wdlRaidHelper";

type EventRow = {
  match_number: string; fixture: GwlFixture; state: string; scheduled_id: string | null;
  event_id: string | null; start_time: string | null; post_at: string | null;
  temporary_role: string | null; member_role_name: string | null; voice_channel_name: string | null; error: string | null;
};
const actor = { discordId: "system:gwl", displayName: "GWL fixture worker" };
const relevant = (fixture: GwlFixture) => JSON.stringify({
  status: fixture.status.toUpperCase(), startsAt: fixture.startsAt, map: fixture.map, layer: fixture.layer, region: fixture.region,
  sides: fixture.sides.map((side) => ({ team: side.team, faction: side.faction })).sort((a, b) => a.team.slug.localeCompare(b.team.slug)),
});

export async function gwlRaidStatus() {
  const [status] = await query<{ last_error: string | null; last_checked_at: Date | null }>("SELECT last_error, last_checked_at FROM gwl_raid_status WHERE id = 1");
  if (!status) throw new Error("GWL Raid Helper migration has not been applied.");
  const events = await query<EventRow>("SELECT * FROM gwl_raid_events ORDER BY CASE WHEN state IN ('review', 'uncertain', 'waiting') THEN 0 ELSE 1 END, updated_at DESC LIMIT 100");
  return {
    lastError: status.last_error, lastCheckedAt: status.last_checked_at?.toISOString() ?? null,
    events: events.map((row) => ({
      matchNumber: row.match_number, state: row.state, error: row.error, scheduledId: row.scheduled_id,
      eventId: row.event_id,
      eventUrl: row.state === "posted" && row.event_id
        ? `https://discord.com/channels/${env().DISCORD_GUILD_ID}/${WDL_EVENT_CHANNEL}/${encodeURIComponent(row.event_id)}` : null,
    })),
  };
}
export type GwlRaidStatus = Awaited<ReturnType<typeof gwlRaidStatus>>;

async function reconcile(rows: EventRow[]) {
  const active = rows.filter((row) => row.scheduled_id && !row.event_id && ["scheduled", "review", "uncertain"].includes(row.state));
  if (!active.length) return;
  const [posted, scheduled, names] = await Promise.all([getPostedWdlEvents(), getScheduledWdlEvents(), wdlEventNames()]);
  for (const row of active) {
    const matches = posted.filter((event) => event.scheduledId === row.scheduled_id && event.channelId === WDL_EVENT_CHANNEL);
    if (matches.length > 1) {
      await query("UPDATE gwl_raid_events SET state = 'review', error = $2, updated_at = now() WHERE match_number = $1 AND state = 'scheduled'",
        [row.match_number, "Multiple posted events match the schedule. Review in Raid Helper."]);
    } else if (matches.length === 1) {
      const event = await getRawWdlEvent(matches[0]!.id);
      if (event.id !== matches[0]!.id || event.serverId !== env().DISCORD_GUILD_ID || event.channelId !== WDL_EVENT_CHANNEL ||
          event.templateId !== "ct34" || event.scheduledId !== row.scheduled_id || event.startTime !== Number(row.start_time) ||
          event.title !== row.temporary_role) {
        await query("UPDATE gwl_raid_events SET state = 'review', error = $2, updated_at = now() WHERE match_number = $1 AND state = 'scheduled'",
          [row.match_number, "The posted event does not match the saved schedule. Review in Raid Helper."]);
      } else {
        const changedNames = row.member_role_name !== names.role || row.voice_channel_name !== names.voice;
        const linked = await query(
          `UPDATE gwl_raid_events SET event_id = $2,
             state = CASE WHEN state = 'scheduled' AND $3 THEN 'review' WHEN state = 'scheduled' THEN 'posted' ELSE state END,
             error = CASE WHEN state = 'scheduled' AND $3 THEN 'The member role or briefing channel was renamed; review this event.' ELSE error END,
             updated_at = now()
           WHERE match_number = $1 AND event_id IS NULL RETURNING match_number`, [row.match_number, event.id, changedNames]);
        if (linked.length) await audit(actor, "gwl.event_posted", "gwl_fixture", row.match_number, { scheduledId: row.scheduled_id, eventId: event.id });
      }
    } else if (row.state === "scheduled" && row.post_at && Number(row.post_at) + 300 < Date.now() / 1000 &&
      !scheduled.some((event) => event.id === row.scheduled_id)) {
      await query("UPDATE gwl_raid_events SET state = 'uncertain', error = $2, updated_at = now() WHERE match_number = $1 AND state = 'scheduled'",
        [row.match_number, "The schedule disappeared without a matching posted event. Check Raid Helper before taking action."]);
    } else if (row.state === "scheduled" && (row.member_role_name !== names.role || row.voice_channel_name !== names.voice)) {
      await query("UPDATE gwl_raid_events SET state = 'review', error = $2, updated_at = now() WHERE match_number = $1 AND state = 'scheduled'",
        [row.match_number, "The member role or briefing channel was renamed; review the scheduled event."]);
    }
  }
}

async function runTick() {
  await query(`UPDATE gwl_raid_events SET state = 'uncertain',
    error = 'Event creation was interrupted. Check Raid Helper and Discord before taking action.', updated_at = now()
    WHERE state = 'creating' AND updated_at < now() - interval '1 minute'`);
  const rows = await query<EventRow>("SELECT * FROM gwl_raid_events");
  await reconcile(rows);
  const snapshot = await getGwlFixtures(true);
  if (snapshot.stale) throw new Error(snapshot.error ?? "GWL fixtures are stale.");
  const all = [...snapshot.data.upcoming, ...snapshot.data.recent];
  for (const fixture of snapshot.data.upcoming) {
    await query("INSERT INTO gwl_raid_events (match_number, fixture, state) VALUES ($1, $2, 'pending') ON CONFLICT DO NOTHING",
      [fixture.number, JSON.stringify(fixture)]);
  }
  for (const row of rows) {
    const current = all.find((fixture) => fixture.number === row.match_number);
    if (!current) {
      if (["pending", "waiting", "scheduled", "posted"].includes(row.state) && Date.parse(row.fixture.startsAt) > Date.now()) {
        await query("UPDATE gwl_raid_events SET state = 'review', error = $2, updated_at = now() WHERE match_number = $1 AND state = $3",
          [row.match_number, "The future fixture is no longer visible in GWL. Review it and any linked event.", row.state]);
      }
      continue;
    }
    if (relevant(row.fixture) === relevant(current)) continue;
    const isCompleted = ["COMPLETED", "CONCLUDED", "FINISHED"].includes(current.status.toUpperCase());
    const state = ["pending", "waiting"].includes(row.state) ? "pending"
      : (["scheduled", "posted"].includes(row.state) && !isCompleted ? "review" : row.state);
    const error = state === "review" && state !== row.state
      ? "GWL changed this fixture. Review the linked Raid Helper event; it was not changed automatically." : state === "pending" ? null : row.error;
    await query("UPDATE gwl_raid_events SET fixture = $2, state = $3, error = $4, updated_at = now() WHERE match_number = $1 AND state = $5",
      [row.match_number, JSON.stringify(current), state, error, row.state]);
  }
  const [candidate] = await query<EventRow>(
    "SELECT * FROM gwl_raid_events WHERE state = 'pending' ORDER BY updated_at LIMIT 1",
  );
  if (!candidate) return;
  let body: ReturnType<typeof gwlEventBody>;
  try {
    const [names, posted, scheduled, reserved] = await Promise.all([
      wdlEventNames(), getPostedWdlEvents(), getScheduledWdlEvents(),
      query<{ temporary_role: string }>(`SELECT temporary_role FROM gwl_raid_events
        WHERE match_number <> $1 AND temporary_role IS NOT NULL AND state IN ('creating', 'scheduled', 'posted', 'review', 'uncertain')
          AND (fixture->>'startsAt')::timestamptz > now()`, [candidate.match_number]),
    ]);
    body = gwlEventBody(candidate.fixture, { ...names, roleNames: [...names.roleNames,
      ...reserved.map((row) => row.temporary_role.toLowerCase()),
      ...scheduled.filter((event) => event.channelId === WDL_EVENT_CHANNEL).map((event) => event.title.toLowerCase()),
    ] }, Math.floor(Date.now() / 1000));
    const briefing = Number(body.date);
    const sameTimeWdl = await query(
      `SELECT fixture_id FROM wdl_fixture_events
        WHERE state IN ('creating', 'scheduled', 'posted', 'review', 'uncertain')
          AND start_time IS NOT NULL AND abs(start_time - $1::bigint) < 60 LIMIT 1`, [briefing],
    );
    const opponents = candidate.fixture.sides.filter((side) => side.team.tag?.trim().toUpperCase() !== "RMNT")
      .map((side) => side.team.tag!.trim().toUpperCase());
    if (sameTimeWdl.length || [...posted, ...scheduled].some((event) => {
      if (event.channelId === WDL_EVENT_CHANNEL && Math.abs(event.startTime - briefing) < 60) return true;
      const tokens = new Set(event.title.toUpperCase().split(/[^A-Z0-9_-]+/).filter(Boolean));
      return Math.abs(event.startTime - (briefing + 1800)) <= 2 * 3600 &&
        (tokens.has("RMNT") || tokens.has("REMNANT")) && opponents.every((tag) => tokens.has(tag));
    })) {
      await query("UPDATE gwl_raid_events SET state = 'review', error = $2, updated_at = now() WHERE match_number = $1 AND state = 'pending'",
        [candidate.match_number, "An event already exists at this briefing time. Check Raid Helper before creating another."]);
      return;
    }
  } catch (error) {
    if (error instanceof HttpError && ["gwl_fixture_incomplete", "gwl_role_collision", "wdl_fixture_late"].includes(error.code ?? "")) {
      await query("UPDATE gwl_raid_events SET state = $2, error = $3, updated_at = now() WHERE match_number = $1 AND state = 'pending'",
        [candidate.match_number, error.code === "gwl_fixture_incomplete" ? "waiting" : "review", error.message]);
      return;
    }
    throw error;
  }
  const latest = await getGwlFixtures(true);
  if (latest.stale) throw new Error(latest.error ?? "GWL fixtures are stale.");
  const current = latest.data.upcoming.find((fixture) => fixture.number === candidate.match_number);
  if (!current || relevant(current) !== relevant(candidate.fixture)) {
    await query("UPDATE gwl_raid_events SET state = 'review', error = $2, updated_at = now() WHERE match_number = $1 AND state = 'pending'",
      [candidate.match_number, "The GWL fixture changed or disappeared during event checks. Review before creating an event."]);
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  if (Number(body.date) <= now) {
    await query("UPDATE gwl_raid_events SET state = 'review', error = $2, updated_at = now() WHERE match_number = $1 AND state = 'pending'",
      [candidate.match_number, "Briefing has already started; review this fixture manually."]);
    return;
  }
  if (body.schedule !== undefined && body.schedule <= now) {
    const { schedule: _schedule, ...immediate } = body;
    body = immediate;
  } else if (body.schedule !== undefined && body.schedule - now < 20) return;
  const claimed = await independentQuery(
    `UPDATE gwl_raid_events SET state = 'creating', start_time = $2, post_at = $3, temporary_role = $4,
       member_role_name = $5, voice_channel_name = $6, error = NULL, updated_at = now()
     WHERE match_number = $1 AND state = 'pending' AND fixture = $7::jsonb RETURNING match_number`,
    [candidate.match_number, Number(body.date), body.schedule ?? null, body.advancedSettings.temp_role,
      body.advancedSettings.allowed_roles, body.advancedSettings.voice_channel, JSON.stringify(candidate.fixture)]);
  if (!claimed.length) return;
  try {
    const result = await createWdlRaidEvent(WDL_EVENT_CHANNEL, body);
    const isScheduled = body.schedule !== undefined;
    try {
      const saved = await independentQuery(
        "UPDATE gwl_raid_events SET scheduled_id = $2, event_id = $3, updated_at = now() WHERE match_number = $1 AND state = 'creating' RETURNING match_number",
        [candidate.match_number, isScheduled ? result.event.id : null, isScheduled ? null : result.event.id]);
      if (!saved.length) throw new Error("The fixture changed while recording the Raid Helper ID.");
    } catch (error) {
      console.error("Could not record returned GWL Raid Helper ID:", { matchNumber: candidate.match_number, raidId: result.event.id, scheduled: isScheduled });
      throw error;
    }
    if (!isScheduled) {
      const event = await getRawWdlEvent(result.event.id);
      if (event.id !== result.event.id || event.serverId !== env().DISCORD_GUILD_ID || event.channelId !== WDL_EVENT_CHANNEL ||
          event.templateId !== "ct34" || event.startTime !== Number(body.date) || event.title !== body.title) {
        throw new Error("The posted event did not match the requested GWL fixture.");
      }
    }
    await independentQuery("UPDATE gwl_raid_events SET state = $2, updated_at = now() WHERE match_number = $1 AND state = 'creating'",
      [candidate.match_number, isScheduled ? "scheduled" : "posted"]);
    await audit(actor, "gwl.event_created", "gwl_fixture", candidate.match_number, { raidId: result.event.id, scheduled: isScheduled });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Raid Helper error";
    await independentQuery("UPDATE gwl_raid_events SET state = 'uncertain', error = $2, updated_at = now() WHERE match_number = $1 AND state = 'creating'",
      [candidate.match_number, `Creation could not be confirmed: ${message}`.slice(0, 500)]);
    await audit(actor, "gwl.event_failed", "gwl_fixture", candidate.match_number, { error: message.slice(0, 500) });
    throw new Error(`GWL event creation could not be confirmed: ${message}`);
  }
}

export async function gwlFixtureTick() {
  await withLeagueEventLock(runTick, true);
}

const g = globalThis as unknown as { __gwlRaidTimer?: NodeJS.Timeout; __gwlRaidRunning?: boolean };
export function startGwlRaidScheduler() {
  if (process.env.NEXT_PHASE === "phase-production-build" || g.__gwlRaidTimer) return;
  const run = () => {
    if (g.__gwlRaidRunning || !env().GWL_API_KEY) return;
    g.__gwlRaidRunning = true;
    void gwlFixtureTick().then(
      () => query("UPDATE gwl_raid_status SET last_error = NULL, last_checked_at = now() WHERE id = 1"),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("GWL Raid Helper:", message);
        return query("UPDATE gwl_raid_status SET last_error = $1, last_checked_at = now() WHERE id = 1", [message.slice(0, 500)]);
      },
    ).catch((error: unknown) => console.error("Could not record GWL Raid Helper status:", error)).finally(() => { g.__gwlRaidRunning = false; });
  };
  g.__gwlRaidTimer = setInterval(run, 60_000);
  g.__gwlRaidTimer.unref();
  setTimeout(run, 30_000).unref();
}
