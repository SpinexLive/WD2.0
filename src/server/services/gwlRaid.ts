import { audit } from "@/lib/audit";
import { independentQuery, query, withLeagueEventLock } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError, ProviderError } from "@/lib/http";
import { z } from "zod";
import { getGwlFixtures, getGwlSlots, type GwlFixture } from "./gwl";
import { gwlEventBody, openSlotEventBody, slotFingerprint, updatedGwlWeatherDescription } from "./gwlRaidHelper";
import { processOpenSlots, readOpenFixture } from "./gwlOpenSlots";
import { createGwlRaidEvent, deleteLeagueRaidEvent, getPostedLeagueEvents, getRawLeagueEvent, getScheduledLeagueEvents, isLeagueEventChannel, updateLeagueEventDescription, leagueEventNames, LEAGUE_EVENT_CHANNEL } from "./leagueRaidHelper";

type EventRow = {
  match_number: string; fixture: GwlFixture; state: string; scheduled_id: string | null;
  event_id: string | null; event_channel_id: string | null; start_time: string | null; post_at: string | null;
  temporary_role: string | null; member_role_name: string | null; voice_channel_name: string | null; error: string | null;
};
const actor = { discordId: "system:gwl", displayName: "GWL fixture worker" };
const missingFixtureError = "The future fixture is no longer visible in GWL. Review it and any linked event.";
const changedFixtureError = "GWL changed this fixture. Review the linked Raid Helper event; it was not changed automatically.";
const deletionInProgress = "Automatic deletion in progress or unconfirmed. Check Raid Helper before taking action.";
const signupsSchema = z.array(z.object({ id: z.number(), userId: z.string() }));
const relevant = (fixture: GwlFixture) => JSON.stringify({
  status: fixture.status.toUpperCase(), startsAt: fixture.startsAt, map: fixture.map, layer: fixture.layer, region: fixture.region,
  sides: fixture.sides.map((side) => ({
    slug: side.team.slug, name: side.team.name, tag: side.team.tag, faction: side.faction,
  })).sort((a, b) => a.slug.localeCompare(b.slug)),
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
      eventUrl: row.state === "posted" && row.event_id && row.event_channel_id
        ? `https://discord.com/channels/${env().DISCORD_GUILD_ID}/${row.event_channel_id}/${encodeURIComponent(row.event_id)}` : null,
    })),
  };
}
export type GwlRaidStatus = Awaited<ReturnType<typeof gwlRaidStatus>>;

async function removeMissingPostedEvent(row: EventRow): Promise<void> {
  if (!row.event_id || !row.event_channel_id || !row.temporary_role || !row.start_time) {
    throw new HttpError(409, "The recorded event identity is incomplete.", "gwl_delete_unsafe");
  }
  const event = await getRawLeagueEvent(row.event_id);
  const description = typeof event.description === "string" ? event.description.split(/\r?\n/) : [];
  if (event.id !== row.event_id || event.serverId !== env().DISCORD_GUILD_ID || event.channelId !== row.event_channel_id ||
      !(await isLeagueEventChannel(event.channelId)) || event.templateId !== "ct34" || event.title !== row.temporary_role ||
      event.startTime !== Number(row.start_time) || event.startTime !== Math.floor(Date.parse(row.fixture.startsAt) / 1000) - 1800 ||
      description.filter((line) => line === "**Competition:** GWL").length !== 1 ||
      description.filter((line) => line === `**Match:** #${row.match_number}`).length !== 1) {
    throw new HttpError(409, "The linked Raid Helper event could not be verified.", "gwl_delete_unsafe");
  }
  const latest = await getGwlFixtures(true);
  if (latest.stale) throw new Error(latest.error ?? "GWL fixtures are stale.");
  if ([...latest.data.upcoming, ...latest.data.recent].some((fixture) => fixture.number === row.match_number)) return;
  const check = await getRawLeagueEvent(row.event_id);
  if (check.id !== event.id || check.serverId !== event.serverId || check.channelId !== event.channelId ||
      check.title !== event.title || check.templateId !== event.templateId || check.startTime !== event.startTime ||
      check.description !== event.description) {
    throw new HttpError(409, "The event changed during deletion checks.", "gwl_delete_unsafe");
  }
  if (Date.parse(row.fixture.startsAt) <= Date.now()) return;
  const claimed = await independentQuery(
    `UPDATE gwl_raid_events SET state = 'uncertain', error = $4, updated_at = now()
       WHERE match_number = $1 AND state = $2 AND event_id = $3 AND fixture = $5::jsonb
         AND ($2 <> 'review' OR error IN ($6, $10)) AND event_channel_id = $7 AND temporary_role = $8 AND start_time = $9
         AND (fixture->>'startsAt')::timestamptz > now() RETURNING match_number`,
    [row.match_number, row.state, row.event_id, deletionInProgress, JSON.stringify(row.fixture), missingFixtureError,
      row.event_channel_id, row.temporary_role, row.start_time, changedFixtureError],
  );
  if (!claimed.length) return;
  await audit(actor, "gwl.event_deletion_started", "gwl_fixture", row.match_number, { eventId: row.event_id });
  let deletionError: unknown;
  try {
    try {
      await deleteLeagueRaidEvent(row.event_id);
    } catch (error) {
      deletionError = error;
    }
    try {
      await getRawLeagueEvent(row.event_id);
      throw new Error(deletionError instanceof Error ? `Deletion was not confirmed: ${deletionError.message}` : "Raid Helper still returns the event.");
    } catch (error) {
      if (!(error instanceof ProviderError && error.provider === "raid-helper" && error.status === 404)) throw error;
    }
    const saved = await independentQuery(
      `UPDATE gwl_raid_events SET state = 'cancelled', error = NULL, updated_at = now()
       WHERE match_number = $1 AND state = 'uncertain' AND event_id = $2 AND error = $3 RETURNING match_number`,
      [row.match_number, row.event_id, deletionInProgress],
    );
    if (!saved.length) throw new Error("The confirmed event deletion could not be recorded.");
  } catch (error) {
    await audit(actor, "gwl.event_deletion_uncertain", "gwl_fixture", row.match_number, { eventId: row.event_id });
    throw new Error(`GWL event deletion could not be confirmed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  await audit(actor, "gwl.event_deleted", "gwl_fixture", row.match_number, { eventId: row.event_id, responseConfirmed: deletionError === undefined });
}

async function updatePostedWeather(row: EventRow, current: GwlFixture): Promise<void> {
  if (relevant(row.fixture) !== relevant(current) || (current.weather === undefined && row.fixture.weather !== undefined) ||
      current.status.trim().toUpperCase() !== "SCHEDULED" || Date.parse(current.startsAt) / 1000 - 1800 <= Date.now() / 1000) return;
  if (!row.event_id || !row.event_channel_id || !row.temporary_role) {
    throw new HttpError(409, "The recorded GWL event identity is incomplete.", "gwl_description_unsafe");
  }
  const event = await getRawLeagueEvent(row.event_id);
  if (event.id !== row.event_id || event.serverId !== env().DISCORD_GUILD_ID || event.channelId !== row.event_channel_id ||
      !(await isLeagueEventChannel(event.channelId)) || event.templateId !== "ct34" ||
      event.startTime !== Math.floor(Date.parse(current.startsAt) / 1000) - 1800 ||
      event.title !== row.temporary_role || typeof event.description !== "string") {
    throw new HttpError(409, "The GWL event identity or description could not be verified.", "gwl_description_unsafe");
  }
  const description = updatedGwlWeatherDescription(event.description, row.fixture, current);
  if (description === event.description) {
    if (row.fixture.weather !== current.weather && current.weather !== undefined) {
      await query("UPDATE gwl_raid_events SET fixture = $2, updated_at = now() WHERE match_number = $1 AND state = 'posted' AND fixture = $3::jsonb",
        [row.match_number, JSON.stringify(current), JSON.stringify(row.fixture)]);
    }
    return;
  }
  const signups = signupsSchema.safeParse(event.signUps);
  if (!signups.success) throw new HttpError(409, "The GWL event signups could not be verified.", "gwl_description_unsafe");
  const latest = await getGwlFixtures(true);
  if (latest.stale) throw new Error(latest.error ?? "GWL fixtures are stale.");
  const fresh = latest.data.upcoming.find((fixture) => fixture.number === row.match_number);
  if (!fresh || relevant(fresh) !== relevant(current) || fresh.weather !== current.weather) {
    throw new HttpError(409, "The GWL fixture changed during the event update checks.", "gwl_description_unsafe");
  }
  const check = await getRawLeagueEvent(row.event_id);
  const latestSignups = signupsSchema.safeParse(check.signUps);
  if (check.id !== event.id || check.serverId !== event.serverId || check.channelId !== event.channelId ||
      check.title !== event.title || check.templateId !== event.templateId || check.startTime !== event.startTime ||
      check.description !== event.description || !latestSignups.success ||
      signups.data.some((signup) => !latestSignups.data.some((item) => item.id === signup.id && item.userId === signup.userId))) {
    throw new HttpError(409, "The GWL event changed during the update checks.", "gwl_description_unsafe");
  }
  const claimed = await independentQuery(
    `UPDATE gwl_raid_events SET state = 'uncertain', error = 'Description update in progress or unconfirmed; check Raid Helper and signups before retrying.', updated_at = now()
       WHERE match_number = $1 AND state = 'posted' AND event_id = $2 AND fixture = $3::jsonb RETURNING match_number`,
    [row.match_number, row.event_id, JSON.stringify(row.fixture)],
  );
  if (!claimed.length) return;
  await audit(actor, "gwl.event_description_update_started", "gwl_fixture", row.match_number, { eventId: row.event_id });
  try {
    await updateLeagueEventDescription(row.event_id, description);
    const updated = await getRawLeagueEvent(row.event_id);
    const updatedSignups = signupsSchema.safeParse(updated.signUps);
    if (updated.id !== event.id || updated.serverId !== event.serverId || updated.channelId !== event.channelId ||
        updated.templateId !== event.templateId || updated.title !== event.title || updated.startTime !== event.startTime ||
        updated.description !== description || !updatedSignups.success ||
        latestSignups.data.some((signup) => !updatedSignups.data.some((item) => item.id === signup.id && item.userId === signup.userId))) {
      throw new Error("The updated description or existing signups could not be verified.");
    }
    const saved = await independentQuery(
      `UPDATE gwl_raid_events SET state = 'posted', fixture = $3, error = NULL, updated_at = now()
        WHERE match_number = $1 AND state = 'uncertain' AND event_id = $2
          AND error = 'Description update in progress or unconfirmed; check Raid Helper and signups before retrying.' RETURNING match_number`,
      [row.match_number, row.event_id, JSON.stringify(current)],
    );
    if (!saved.length) throw new Error("The verified description update could not be recorded.");
  } catch (error) {
    await audit(actor, "gwl.event_description_update_uncertain", "gwl_fixture", row.match_number, { eventId: row.event_id });
    throw new Error(`GWL event description update could not be confirmed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  await audit(actor, "gwl.event_description_updated", "gwl_fixture", row.match_number, { eventId: row.event_id });
}

async function reconcile(rows: EventRow[]) {
  const active = rows.filter((row) => row.scheduled_id && !row.event_id && ["scheduled", "review", "uncertain"].includes(row.state));
  if (!active.length) return;
  const [posted, scheduled, names] = await Promise.all([getPostedLeagueEvents(), getScheduledLeagueEvents(), leagueEventNames()]);
  for (const row of active) {
    const matches = posted.filter((event) => event.scheduledId === row.scheduled_id);
    if (matches.length > 1) {
      await query("UPDATE gwl_raid_events SET state = 'review', error = $2, updated_at = now() WHERE match_number = $1 AND state = 'scheduled'",
        [row.match_number, "Multiple posted events match the schedule. Review in Raid Helper."]);
    } else if (matches.length === 1) {
      const event = await getRawLeagueEvent(matches[0]!.id);
      if (event.id !== matches[0]!.id || event.serverId !== env().DISCORD_GUILD_ID || !(await isLeagueEventChannel(event.channelId)) ||
          event.templateId !== "ct34" || event.scheduledId !== row.scheduled_id || event.startTime !== Number(row.start_time) ||
          event.title !== row.temporary_role) {
        await query("UPDATE gwl_raid_events SET state = 'review', error = $2, updated_at = now() WHERE match_number = $1 AND state = 'scheduled'",
          [row.match_number, "The posted event does not match the saved schedule. Review in Raid Helper."]);
      } else {
        const changedNames = row.member_role_name !== names.role || row.voice_channel_name !== names.voice;
        const linked = await query(
          `UPDATE gwl_raid_events SET event_id = $2, event_channel_id = $4,
             state = CASE WHEN state = 'scheduled' AND $3 THEN 'review' WHEN state = 'scheduled' THEN 'posted' ELSE state END,
             error = CASE WHEN state = 'scheduled' AND $3 THEN 'The member role or briefing channel was renamed; review this event.' ELSE error END,
             updated_at = now()
           WHERE match_number = $1 AND event_id IS NULL RETURNING match_number`, [row.match_number, event.id, changedNames, event.channelId]);
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
  const beforeReconcile = await query<EventRow>("SELECT * FROM gwl_raid_events");
  await reconcile(beforeReconcile);
  const snapshot = await getGwlFixtures(true);
  if (snapshot.stale) throw new Error(snapshot.error ?? "GWL fixtures are stale.");
  const blocked = await processOpenSlots(snapshot.data.upcoming, snapshot.data.recent);
  const rows = await query<EventRow>("SELECT * FROM gwl_raid_events");
  const all = [...snapshot.data.upcoming, ...snapshot.data.recent];
  for (const fixture of snapshot.data.upcoming) {
    if (blocked.has(fixture.number)) continue;
    await query("INSERT INTO gwl_raid_events (match_number, fixture, state) VALUES ($1, $2, 'pending') ON CONFLICT DO NOTHING",
      [fixture.number, JSON.stringify(fixture)]);
  }
  for (const row of rows) {
    if (row.match_number.startsWith("slot:")) continue;
    const current = all.find((fixture) => fixture.number === row.match_number);
    if (!current) {
      if (Date.parse(row.fixture.startsAt) <= Date.now()) continue;
      const fixtureReview = row.state === "review" && (row.error === missingFixtureError || row.error === changedFixtureError);
      if (row.state === "posted" || (fixtureReview && row.event_id)) {
        try {
          await removeMissingPostedEvent(row);
        } catch (error) {
          if (error instanceof HttpError && error.code === "gwl_delete_unsafe") {
            await query("UPDATE gwl_raid_events SET state = 'review', error = $2, updated_at = now() WHERE match_number = $1 AND state = $3",
              [row.match_number, `${error.message} Check the event in Raid Helper.`, row.state]);
          } else throw error;
        }
      } else if (["pending", "waiting"].includes(row.state) && !row.event_id && !row.scheduled_id) {
        await query("UPDATE gwl_raid_events SET state = 'cancelled', error = NULL, updated_at = now() WHERE match_number = $1 AND state = $2",
          [row.match_number, row.state]);
      } else if (row.state === "scheduled" || (fixtureReview && row.scheduled_id && !row.event_id)) {
        await query("UPDATE gwl_raid_events SET state = 'review', error = $2, updated_at = now() WHERE match_number = $1 AND state = $3",
          [row.match_number, "The GWL fixture disappeared. Remove the scheduled Raid Helper event manually; automatic schedule deletion is not verified.", row.state]);
      }
      continue;
    }
    if (row.state === "cancelled") {
      await query("UPDATE gwl_raid_events SET state = 'review', error = $2, updated_at = now() WHERE match_number = $1 AND state = 'cancelled'",
        [row.match_number, "This removed fixture is visible in GWL again. Review before creating another event."]);
      continue;
    }
    if (relevant(row.fixture) === relevant(current)) {
      if (["pending", "waiting"].includes(row.state) &&
          (row.fixture.mapName !== current.mapName || row.fixture.zone !== current.zone)) {
        await query("UPDATE gwl_raid_events SET fixture = $2, updated_at = now() WHERE match_number = $1 AND state = $3 AND fixture = $4::jsonb",
          [row.match_number, JSON.stringify(current), row.state, JSON.stringify(row.fixture)]);
      }
      continue;
    }
    const isCompleted = ["COMPLETED", "CONCLUDED", "FINISHED"].includes(current.status.toUpperCase());
    const state = ["pending", "waiting"].includes(row.state) ? "pending"
      : (["scheduled", "posted"].includes(row.state) && !isCompleted ? "review" : row.state);
    const error = state === "review" && state !== row.state
      ? changedFixtureError : state === "pending" ? null : row.error;
    await query("UPDATE gwl_raid_events SET fixture = $2, state = $3, error = $4, updated_at = now() WHERE match_number = $1 AND state = $5",
      [row.match_number, JSON.stringify(current), state, error, row.state]);
  }
  for (const row of rows.filter((item) => item.state === "posted")) {
    if (row.match_number.startsWith("slot:")) continue;
    const fixture = snapshot.data.upcoming.find((item) => item.number === row.match_number);
    if (!fixture || relevant(row.fixture) !== relevant(fixture)) continue;
    try {
      await updatePostedWeather(row, fixture);
    } catch (error) {
      if (error instanceof HttpError && error.code === "gwl_description_unsafe") {
        await query("UPDATE gwl_raid_events SET state = 'review', error = $2, updated_at = now() WHERE match_number = $1 AND state = 'posted'",
          [row.match_number, `${error.message} Review the event and its signups in Raid Helper.`]);
      } else throw error;
    }
  }
  const [candidate] = await query<EventRow>(
    "SELECT * FROM gwl_raid_events WHERE state = 'pending' AND NOT (match_number = ANY($1::text[])) ORDER BY updated_at LIMIT 1",
    [[...blocked]],
  );
  if (!candidate) return;
  let body: ReturnType<typeof gwlEventBody>;
  try {
    const [names, posted, scheduled, reserved] = await Promise.all([
      leagueEventNames(), getPostedLeagueEvents(), getScheduledLeagueEvents(),
      query<{ temporary_role: string }>(`SELECT temporary_role FROM gwl_raid_events
        WHERE match_number <> $1 AND temporary_role IS NOT NULL AND state IN ('creating', 'scheduled', 'posted', 'review', 'uncertain')
          AND (fixture->>'startsAt')::timestamptz > now()`, [candidate.match_number]),
    ]);
    const bodyNames = { ...names, roleNames: [...names.roleNames,
      ...reserved.map((row) => row.temporary_role.toLowerCase()),
      ...scheduled.filter((event) => event.channelId === LEAGUE_EVENT_CHANNEL).map((event) => event.title.toLowerCase()),
    ] };
    const open = readOpenFixture(candidate.fixture);
    if (candidate.match_number.startsWith("slot:") && !open) throw new Error("Stored GWL open-slot identity is invalid.");
    body = open ? openSlotEventBody(open, bodyNames, Math.floor(Date.now() / 1000))
      : gwlEventBody(candidate.fixture, bodyNames, Math.floor(Date.now() / 1000));
    const briefing = Number(body.date);
    const opponents = candidate.fixture.sides.filter((side) => side.team.tag?.trim().toUpperCase() !== "RMNT")
      .map((side) => side.team.tag!.trim().toUpperCase());
    const sameTimePosted = await Promise.all(posted.filter((event) => Math.abs(event.startTime - briefing) < 60)
      .map((event) => isLeagueEventChannel(event.channelId)));
    if (sameTimePosted.some(Boolean) || [...posted, ...scheduled].some((event) => {
      if (event.channelId === LEAGUE_EVENT_CHANNEL && Math.abs(event.startTime - briefing) < 60) return true;
      const tokens = new Set(event.title.toUpperCase().split(/[^A-Z0-9_-]+/).filter(Boolean));
      return Math.abs(event.startTime - (briefing + 1800)) <= 2 * 3600 &&
        (tokens.has("RMNT") || tokens.has("REMNANT")) && opponents.every((tag) => tokens.has(tag));
    })) {
      await query("UPDATE gwl_raid_events SET state = 'review', error = $2, updated_at = now() WHERE match_number = $1 AND state = 'pending'",
        [candidate.match_number, "An event already exists at this briefing time. Check Raid Helper before creating another."]);
      return;
    }
  } catch (error) {
    if (error instanceof HttpError && ["gwl_fixture_incomplete", "gwl_role_collision", "gwl_fixture_late"].includes(error.code ?? "")) {
      await query("UPDATE gwl_raid_events SET state = $2, error = $3, updated_at = now() WHERE match_number = $1 AND state = 'pending'",
        [candidate.match_number, error.code === "gwl_fixture_incomplete" ? "waiting" : "review", error.message]);
      return;
    }
    throw error;
  }
  const latest = await getGwlFixtures(true);
  if (latest.stale) throw new Error(latest.error ?? "GWL fixtures are stale.");
  const openCandidate = readOpenFixture(candidate.fixture);
  const current = latest.data.upcoming.find((fixture) => fixture.number === candidate.match_number);
  const currentSlots = openCandidate ? await getGwlSlots(true) : null;
  if (currentSlots?.stale) throw new Error(currentSlots.error ?? "GWL slots are stale.");
  const slot = currentSlots?.data.slots.find((item) => item.id === openCandidate?.openSlot.id);
  const slotChanged = openCandidate && (!slot || slotFingerprint(slot) !== slotFingerprint(openCandidate.openSlot) ||
    latest.data.upcoming.some((fixture) => Date.parse(fixture.startsAt) === Date.parse(openCandidate.startsAt)
      && fixture.region === openCandidate.region && fixture.sides.some((side) => side.team.slug === openCandidate.teamSlug)));
  if (openCandidate ? slotChanged : !current || relevant(current) !== relevant(candidate.fixture)) {
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
    const result = await createGwlRaidEvent(LEAGUE_EVENT_CHANNEL, body);
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
    if (isScheduled) {
      const event = (await getScheduledLeagueEvents()).find((item) => item.id === result.event.id);
      if (!event || event.channelId !== LEAGUE_EVENT_CHANNEL || event.startTime !== Number(body.date) ||
          event.title !== body.title || event.postTime !== body.schedule) {
        throw new Error("The scheduled event did not match the requested GWL fixture.");
      }
    } else {
      const event = await getRawLeagueEvent(result.event.id);
      if (event.id !== result.event.id || event.serverId !== env().DISCORD_GUILD_ID || !(await isLeagueEventChannel(event.channelId)) ||
          event.templateId !== "ct34" || event.startTime !== Number(body.date) || event.title !== body.title) {
        throw new Error("The posted event did not match the requested GWL fixture.");
      }
      await independentQuery("UPDATE gwl_raid_events SET event_channel_id = $2 WHERE match_number = $1 AND state = 'creating'", [candidate.match_number, event.channelId]);
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
