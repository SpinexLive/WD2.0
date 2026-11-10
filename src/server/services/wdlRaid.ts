import { createHash } from "node:crypto";
import { z } from "zod";
import { independentQuery, query, tx, withLeagueEventLock } from "@/lib/db";
import { audit } from "@/lib/audit";
import { HttpError, ProviderError } from "@/lib/http";
import type { Session } from "@/lib/session";
import { fixtureOpponents, type WdlFixture, type WdlFixtures } from "@/lib/wdlFixtures";
import { getLeagueFixtures } from "./wardogsLeague";
import { archiveWdlFixtures } from "./wdlFixtures";
import { createWdlRaidEvent, deleteWdlRaidEvent, getPostedWdlEvents, getRawWdlEvent, getScheduledWdlEvents, updateWdlEventDescription, updatedWdlDescription, wdlEventBody, wdlEventNames, WDL_EVENT_CHANNEL } from "./wdlRaidHelper";

type Actor = Pick<Session, "discordId" | "displayName">;

export async function wdlRaidStatus() {
  const [settings] = await query<{ enabled: boolean; activation_pending: boolean; baseline_at: Date | null; last_error: string | null }>(
    "SELECT enabled, activation_pending, baseline_at, last_error FROM wdl_raid_settings WHERE id = 1",
  );
  if (!settings) throw new Error("WDL fixture migration has not been applied.");
  const events = await query<{ fixture_id: string; fixture: WdlFixture; state: string; scheduled_id: string | null; event_id: string | null; event_channel_id: string | null; error: string | null }>(
    "SELECT fixture_id, fixture, state, scheduled_id, event_id, event_channel_id, error FROM wdl_fixture_events WHERE NOT baseline ORDER BY updated_at DESC LIMIT 100",
  );
  const resultPosts = await query<{ fixture_id: string; fixture_number: string | null; state: string; message_id: string | null; error: string | null }>(
    "SELECT fixture_id, fixture->>'number' AS fixture_number, state, message_id, error FROM wdl_result_posts WHERE state <> 'posted' OR error IS NOT NULL ORDER BY updated_at DESC LIMIT 100",
  );
  const [resultsStatus] = await query<{ last_error: string | null; last_checked_at: Date | null }>(
    "SELECT last_error, last_checked_at FROM wdl_result_post_status WHERE id = 1",
  );
  if (!resultsStatus) throw new Error("WDL result posts migration has not been applied.");
  return {
    enabled: settings.enabled, activationPending: settings.activation_pending,
    baselineAt: settings.baseline_at?.toISOString() ?? null, lastError: settings.last_error,
    events: events.map((row) => ({ fixtureId: row.fixture_id, fixture: row.fixture, state: row.state,
      scheduledId: row.scheduled_id, eventId: row.event_id, eventChannelId: row.event_channel_id, error: row.error })),
    results: {
      lastError: resultsStatus.last_error, lastCheckedAt: resultsStatus.last_checked_at?.toISOString() ?? null,
      issues: resultPosts.map((row) => ({ fixtureId: row.fixture_id, fixtureNumber: row.fixture_number, state: row.state, messageId: row.message_id, error: row.error })),
    },
  };
}
export type WdlRaidStatus = Awaited<ReturnType<typeof wdlRaidStatus>>;

export async function wdlCreatedEventLog(before: string | null) {
  const rows = await query<{
    id: string; fixture_id: string; channel_id: string | null; scheduled_id: string | null;
    event_id: string | null; event_verified: boolean; origin: "automatic" | "legacy"; created_at: Date;
  }>(
    `SELECT entry.id::text AS id, entry.fixture_id, entry.channel_id, entry.scheduled_id,
            entry.event_id, entry.event_verified, entry.origin, entry.created_at
       FROM wdl_created_events AS entry
      WHERE ($1::bigint IS NULL OR entry.id < $1::bigint) ORDER BY entry.id DESC LIMIT 51`,
    [before],
  );
  const page = rows.slice(0, 50);
  return {
    events: page.map((row) => ({
      id: row.id, fixtureId: row.fixture_id, channelId: row.channel_id, scheduledId: row.scheduled_id,
      eventId: row.event_id, eventVerified: row.event_verified, origin: row.origin, createdAt: row.created_at.toISOString(),
    })),
    nextCursor: rows.length > 50 ? page[page.length - 1]!.id : null,
  };
}
export type WdlCreatedEventLog = Awaited<ReturnType<typeof wdlCreatedEventLog>>;

async function activateWdlRaidAutomation(fixtures: WdlFixtures, pendingOnly: boolean) {
  return tx(async (client) => {
    const settings = await client.query<{ enabled: boolean; activation_pending: boolean; baseline_at: Date | null }>(
      "SELECT enabled, activation_pending, baseline_at FROM wdl_raid_settings WHERE id = 1 FOR UPDATE",
    );
    const current = settings.rows[0];
    if (!current) throw new Error("WDL fixture migration has not been applied.");
    if (pendingOnly && !current.activation_pending) return null;
    let baselineCount = 0;
    if (current.baseline_at === null) {
      for (const fixture of [...fixtures.upcoming, ...fixtures.recent]) {
        await client.query(
          `INSERT INTO wdl_fixture_events (fixture_id, fixture, baseline, state) VALUES ($1, $2, true, 'baseline')
           ON CONFLICT (fixture_id) DO NOTHING`,
          [fixture.id, JSON.stringify(fixture)],
        );
      }
      baselineCount = fixtures.upcoming.length + fixtures.recent.length;
    }
    await client.query(
      "UPDATE wdl_raid_settings SET enabled = true, activation_pending = false, baseline_at = COALESCE(baseline_at, now()), last_error = NULL WHERE id = 1",
    );
    return baselineCount;
  });
}

export async function enableWdlRaidAutomation(actor: Actor) {
  const snapshot = await getLeagueFixtures(true);
  if (snapshot.stale) throw new HttpError(503, "Current WDL fixtures are unavailable; cannot enable automation.", "wdl_stale");
  await archiveWdlFixtures(snapshot.data);
  const baselineCount = await activateWdlRaidAutomation(snapshot.data, false);
  await audit(actor, "wdl.automation_enabled", "wdl", "fixtures", { baselineCount });
  return wdlRaidStatus();
}

export async function disableWdlRaidAutomation(actor: Actor) {
  await query("UPDATE wdl_raid_settings SET enabled = false, activation_pending = false WHERE id = 1");
  await audit(actor, "wdl.automation_disabled", "wdl", "fixtures");
  return wdlRaidStatus();
}

export async function linkExistingWdlEvent(fixtureId: string, eventId: string, actor: Actor) {
  const [row] = await query<{ state: string; start_time: string | null; recoverable: boolean }>(
    "SELECT state, start_time, (state <> 'creating' OR updated_at < now() - interval '1 minute') AS recoverable FROM wdl_fixture_events WHERE fixture_id = $1", [fixtureId],
  );
  if (!row || !["review", "uncertain", "creating"].includes(row.state)) throw new HttpError(409, "This fixture is not awaiting review.", "wdl_not_review");
  if (!row.recoverable) throw new HttpError(409, "Event creation may still be in progress. Wait before recovering it.", "wdl_creation_in_progress");
  const event = await getRawWdlEvent(eventId);
  if (event.serverId !== "1332320879073296404" || !/^\d{15,22}$/.test(event.channelId)) {
    throw new HttpError(400, "The selected event is not in the configured Discord server.", "wdl_wrong_event");
  }
  const current = await currentUpcomingFixture(fixtureId);
  if (!current.scheduledAt || event.startTime !== Math.floor(Date.parse(current.scheduledAt) / 1000) - 1800) {
    throw new HttpError(400, "The selected event does not match the current WDL briefing time.", "wdl_wrong_event");
  }
  if (row.state !== "review" && row.start_time !== null && event.startTime !== Number(row.start_time)) {
    throw new HttpError(400, "The selected event does not match the attempted fixture time.", "wdl_wrong_event");
  }
  let updated: unknown[];
  try {
    updated = await query(
      "UPDATE wdl_fixture_events SET state = 'posted', event_id = $2, fixture = $4, event_channel_id = $5, error = NULL, updated_at = now() WHERE fixture_id = $1 AND state = ANY($3::text[]) RETURNING fixture_id",
      [fixtureId, eventId, ["review", "uncertain", "creating"], JSON.stringify(current), event.channelId],
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") throw new HttpError(409, "That Raid Helper event is already linked to another fixture.", "wdl_event_linked");
    throw error;
  }
  if (!updated.length) throw new HttpError(409, "The fixture changed while it was being reviewed.", "wdl_not_review");
  await audit(actor, "wdl.event_linked", "wdl_fixture", fixtureId, { eventId });
  return wdlRaidStatus();
}

async function currentUpcomingFixture(fixtureId: string) {
  const snapshot = await getLeagueFixtures(true);
  if (snapshot.stale) throw new HttpError(503, "Current WDL fixtures are unavailable.", "wdl_stale");
  const fixture = snapshot.data.upcoming.find((item) => item.id === fixtureId);
  if (!fixture || fixture.status.toUpperCase() !== "SCHEDULED") throw new HttpError(409, "This fixture is not currently scheduled in WDL.", "wdl_fixture_incomplete");
  return fixture;
}

const signupIds = z.array(z.object({ id: z.number(), userId: z.string() }));

async function prepareWdlEventDescription(fixtureId: string) {
  const [row] = await query<{ fixture: WdlFixture; state: string; event_id: string | null; event_channel_id: string | null; verified: boolean }>(
    `SELECT fixture.fixture, fixture.state, fixture.event_id, fixture.event_channel_id,
            EXISTS (SELECT 1 FROM wdl_created_events AS recorded
                     WHERE recorded.fixture_id = fixture.fixture_id AND recorded.event_id = fixture.event_id
                       AND recorded.channel_id = fixture.event_channel_id AND recorded.origin = 'automatic'
                       AND recorded.event_verified) AS verified
       FROM wdl_fixture_events AS fixture WHERE fixture.fixture_id = $1`, [fixtureId],
  );
  if (!row || row.state !== "posted" || !row.event_id || row.event_channel_id !== WDL_EVENT_CHANNEL || !row.verified) {
    throw new HttpError(409, "Only verified, automatically created and posted events can be previewed. Scheduled, linked, unverified and review-state events are excluded.", "wdl_event_ineligible");
  }
  const fixture = await currentUpcomingFixture(fixtureId);
  if (fixtureChanged(row.fixture, fixture)) throw new HttpError(409, "The WDL fixture has changed; review it before editing the event.", "wdl_fixture_changed");
  const opponents = fixtureOpponents(fixture);
  const briefing = fixture.scheduledAt ? Math.floor(Date.parse(fixture.scheduledAt) / 1000) - 1800 : NaN;
  if (!opponents || !Number.isFinite(briefing) || briefing <= Date.now() / 1000) {
    throw new HttpError(409, "The fixture is incomplete or briefing has started; review it manually.", "wdl_fixture_incomplete");
  }
  const event = await getRawWdlEvent(row.event_id);
  if (event.id !== row.event_id || event.serverId !== "1332320879073296404" || event.channelId !== row.event_channel_id ||
      event.templateId !== "ct34" || event.startTime !== briefing || event.title !== `RMNT v ${opponents.join(" v ")}` ||
      typeof event.description !== "string") {
    throw new HttpError(409, "The Raid Helper event identity or description does not match the recorded fixture; review it manually.", "wdl_wrong_event");
  }
  const proposed = updatedWdlDescription(event.description, fixture);
  const signups = signupIds.safeParse(event.signUps);
  if (!signups.success) throw new HttpError(409, "Raid Helper did not return identifiable signups; review this event manually.", "wdl_signups_unavailable");
  const version = createHash("sha256").update(JSON.stringify([fixtureId, fixture, event.id, event.channelId, event.title,
    event.templateId, event.startTime, event.description, proposed])).digest("hex");
  return {
    preview: { fixtureId, fixture, eventId: event.id, title: event.title, startTime: event.startTime, current: event.description, proposed, version, changed: proposed !== event.description },
    signups: signups.data,
  };
}

export async function previewWdlEventDescription(fixtureId: string) {
  return (await prepareWdlEventDescription(fixtureId)).preview;
}
export type WdlEventDescriptionPreview = Awaited<ReturnType<typeof previewWdlEventDescription>>;

export async function applyWdlEventDescription(fixtureId: string, version: string, actor: Actor) {
  const { preview, signups } = await prepareWdlEventDescription(fixtureId);
  if (preview.version !== version) throw new HttpError(409, "The fixture or event changed since the preview. Preview it again.", "wdl_preview_stale");
  if (!preview.changed) throw new HttpError(409, "The event description is already up to date.", "wdl_no_change");
  const claimed = await query(
    `UPDATE wdl_fixture_events SET state = 'uncertain', error = 'Description update in progress or unconfirmed; check Raid Helper before retrying.', updated_at = now()
      WHERE fixture_id = $1 AND state = 'posted' AND event_id = $2
        AND fixture = $3::jsonb RETURNING fixture_id`,
    [fixtureId, preview.eventId, JSON.stringify(preview.fixture)],
  );
  if (!claimed.length) throw new HttpError(409, "The fixture changed or another update is in progress. Preview it again.", "wdl_preview_stale");
  await audit(actor, "wdl.event_description_update_started", "wdl_fixture", fixtureId, { eventId: preview.eventId });
  try {
    await updateWdlEventDescription(preview.eventId, preview.proposed);
    const updated = await getRawWdlEvent(preview.eventId);
    if (updated.id !== preview.eventId || updated.serverId !== "1332320879073296404" || updated.channelId !== WDL_EVENT_CHANNEL ||
        updated.title !== preview.title || updated.templateId !== "ct34" || updated.startTime !== preview.startTime || updated.description !== preview.proposed) {
      throw new Error("Raid Helper readback did not match the confirmed update.");
    }
    const updatedSignups = signupIds.safeParse(updated.signUps);
    if (!updatedSignups.success || signups.some((signup) => !updatedSignups.data.some((item) => item.id === signup.id && item.userId === signup.userId))) {
      throw new Error("The signup list could not be verified after the event update.");
    }
  } catch (error) {
    console.error("WDL event description update could not be verified:", error instanceof Error ? error.message : "unknown error");
    await audit(actor, "wdl.event_description_update_uncertain", "wdl_fixture", fixtureId, { eventId: preview.eventId });
    throw new HttpError(502, "The update could not be verified. Check the event and its signups in Raid Helper before taking further action.", "wdl_update_uncertain");
  }
  const finished = await query(
    `UPDATE wdl_fixture_events SET state = 'posted', error = NULL, updated_at = now()
      WHERE fixture_id = $1 AND state = 'uncertain' AND event_id = $2
        AND fixture = $3::jsonb AND error = 'Description update in progress or unconfirmed; check Raid Helper before retrying.'
      RETURNING fixture_id`, [fixtureId, preview.eventId, JSON.stringify(preview.fixture)],
  );
  if (!finished.length) throw new HttpError(409, "The description was updated, but the fixture changed during the operation. Review its dashboard status and Raid Helper.", "wdl_update_review");
  await audit(actor, "wdl.event_description_updated", "wdl_fixture", fixtureId, { eventId: preview.eventId });
  return wdlRaidStatus();
}

export async function recoverScheduledWdlEvent(fixtureId: string, scheduledId: string, actor: Actor) {
  const [row] = await query<{ state: string; start_time: string | null; fixture: WdlFixture; recoverable: boolean }>(
    "SELECT state, start_time, fixture, (state <> 'creating' OR updated_at < now() - interval '1 minute') AS recoverable FROM wdl_fixture_events WHERE fixture_id = $1", [fixtureId],
  );
  if (!row || !["review", "uncertain", "creating"].includes(row.state)) throw new HttpError(409, "This fixture is not awaiting review.", "wdl_not_review");
  if (!row.recoverable) throw new HttpError(409, "Event creation may still be in progress. Wait before recovering it.", "wdl_creation_in_progress");
  const current = await currentUpcomingFixture(fixtureId);
  const expectedStart = current.scheduledAt ? Math.floor(Date.parse(current.scheduledAt) / 1000) - 1800 : null;
  const event = (await getScheduledWdlEvents()).find((item) => item.id === scheduledId);
  if (!event || expectedStart === null || !/^\d{15,22}$/.test(event.channelId) || event.startTime !== expectedStart) {
    throw new HttpError(400, "The scheduled event does not match this fixture and channel.", "wdl_wrong_event");
  }
  const names = await wdlEventNames();
  let updated: unknown[];
  try {
    updated = await query(
      `UPDATE wdl_fixture_events SET state = 'scheduled', scheduled_id = $2, start_time = $3, post_at = $4, fixture = $6,
          member_role_name = $7, voice_channel_name = $8, event_channel_id = $9, error = NULL, updated_at = now()
        WHERE fixture_id = $1 AND state = ANY($5::text[]) RETURNING fixture_id`,
      [fixtureId, scheduledId, event.startTime, event.postTime, ["review", "uncertain", "creating"], JSON.stringify(current), names.role, names.voice, event.channelId],
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") throw new HttpError(409, "That scheduled event is already linked to another fixture.", "wdl_event_linked");
    throw error;
  }
  if (!updated.length) throw new HttpError(409, "The fixture changed while it was being reviewed.", "wdl_not_review");
  await audit(actor, "wdl.schedule_linked", "wdl_fixture", fixtureId, { scheduledId });
  return wdlRaidStatus();
}

export async function retryReviewedWdlFixture(fixtureId: string, actor: Actor) {
  const [row] = await query<{ state: string; event_id: string | null; scheduled_id: string | null; recoverable: boolean }>(
    `SELECT state, event_id, scheduled_id, (state <> 'creating' OR updated_at < now() - interval '1 minute') AS recoverable
       FROM wdl_fixture_events WHERE fixture_id = $1`, [fixtureId],
  );
  if (!row || !["review", "uncertain", "creating"].includes(row.state) || row.event_id || row.scheduled_id) {
    throw new HttpError(409, "This fixture has a linked event or is not awaiting review.", "wdl_not_review");
  }
  if (!row.recoverable) throw new HttpError(409, "Event creation may still be in progress. Wait before retrying.", "wdl_creation_in_progress");
  const snapshot = await getLeagueFixtures(true);
  if (snapshot.stale) throw new HttpError(503, "Current WDL fixtures are unavailable.", "wdl_stale");
  const fixture = snapshot.data.upcoming.find((item) => item.id === fixtureId);
  if (!fixture) throw new HttpError(409, "The fixture is no longer visible in WDL.", "wdl_fixture_incomplete");
  const now = Math.floor(Date.now() / 1000);
  const body = wdlEventBody(fixture, await wdlEventNames(), now);
  const [posted, scheduled] = await Promise.all([getPostedWdlEvents(), getScheduledWdlEvents()]);
  if ([...posted, ...scheduled].some((event) => possibleWdlEvent(fixture, Number(body.date), event))) {
    throw new HttpError(409, "A Raid Helper event exists at this time. Link it instead of retrying.", "wdl_possible_duplicate");
  }
  const updated = await query(
    `UPDATE wdl_fixture_events SET fixture = $2, state = 'pending', error = NULL, temporary_role = NULL, updated_at = now()
      WHERE fixture_id = $1 AND state = ANY($3::text[]) AND event_id IS NULL AND scheduled_id IS NULL RETURNING fixture_id`,
    [fixtureId, JSON.stringify(fixture), ["review", "uncertain", "creating"]],
  );
  if (!updated.length) throw new HttpError(409, "The fixture changed while it was being reviewed.", "wdl_not_review");
  await audit(actor, "wdl.event_retry_requested", "wdl_fixture", fixtureId);
  return wdlRaidStatus();
}

export async function deleteReviewedWdlEvent(fixtureId: string, actor: Actor) {
  const [row] = await query<{ state: string; event_id: string | null; event_channel_id: string | null }>("SELECT state, event_id, event_channel_id FROM wdl_fixture_events WHERE fixture_id = $1", [fixtureId]);
  if (!row || row.state !== "review" || !row.event_id) throw new HttpError(409, "No posted event is available for deletion; check Raid Helper manually.", "wdl_not_review");
  const event = await getRawWdlEvent(row.event_id);
  if (event.serverId !== "1332320879073296404" || !row.event_channel_id || event.channelId !== row.event_channel_id) {
    throw new HttpError(409, "The linked event is not in its recorded Discord channel.", "wdl_wrong_event");
  }
  const claimed = await query(
    "UPDATE wdl_fixture_events SET state = 'uncertain', error = 'Deletion in progress; check Raid Helper before retrying.', updated_at = now() WHERE fixture_id = $1 AND state = 'review' AND event_id = $2 RETURNING fixture_id",
    [fixtureId, row.event_id],
  );
  if (!claimed.length) throw new HttpError(409, "This event is already being handled.", "wdl_not_review");
  try {
    await deleteWdlRaidEvent(row.event_id);
  } catch (error) {
    await audit(actor, "wdl.event_delete_failed", "wdl_fixture", fixtureId, { eventId: row.event_id });
    throw new HttpError(502, "Could not confirm whether Raid Helper deleted the event. Check Raid Helper before retrying.", "wdl_delete_uncertain");
  }
  try {
    await query("UPDATE wdl_fixture_events SET state = 'cancelled', error = NULL, updated_at = now() WHERE fixture_id = $1", [fixtureId]);
  } catch (error) {
    console.error("Raid Helper event was deleted but could not be recorded:", error instanceof Error ? error.message : "unknown");
    throw new HttpError(503, "The Raid Helper event was deleted, but the result could not be recorded. Check the dashboard before retrying.", "wdl_delete_uncertain");
  }
  await audit(actor, "wdl.event_deleted", "wdl_fixture", fixtureId, { eventId: row.event_id });
  return wdlRaidStatus();
}

function fixtureChanged(a: WdlFixture, b: WdlFixture) {
  const relevant = (fixture: WdlFixture) => ({
    number: fixture.number, status: fixture.status, scheduledAt: fixture.scheduledAt, map: fixture.map, competition: fixture.competition,
    participants: fixture.participants.map((p) => ({ team: p.team, faction: p.faction }))
      .sort((left, right) => (left.team.code ?? left.team.name ?? "").localeCompare(right.team.code ?? right.team.name ?? "")),
  });
  return JSON.stringify(relevant(a)) !== JSON.stringify(relevant(b));
}

function possibleWdlEvent(fixture: WdlFixture, briefing: number, event: { channelId: string; startTime: number; title: string }): boolean {
  if (event.channelId === WDL_EVENT_CHANNEL && Math.abs(event.startTime - briefing) < 60) return true;
  const opponents = fixtureOpponents(fixture);
  if (!opponents || Math.abs(event.startTime - (briefing + 1800)) > 2 * 3600) return false;
  const tokens = new Set(event.title.toUpperCase().split(/[^A-Z0-9_-]+/).filter(Boolean));
  return (tokens.has("RMNT") || tokens.has("REMNANT")) && opponents.every((code) => tokens.has(code.toUpperCase()));
}

async function recoverRecordedWdlEventIds() {
  await query(
    `WITH candidates AS (
       SELECT fixture.fixture_id, min(recorded.id) AS recorded_id
         FROM wdl_fixture_events AS fixture
         JOIN wdl_created_events AS recorded ON recorded.fixture_id = fixture.fixture_id
          AND recorded.origin = 'automatic' AND recorded.created_at >= fixture.updated_at
        WHERE fixture.state = 'creating' AND fixture.updated_at < now() - interval '1 minute'
          AND fixture.scheduled_id IS NULL AND fixture.event_id IS NULL
        GROUP BY fixture.fixture_id HAVING count(*) = 1
     )
     UPDATE wdl_fixture_events AS fixture
        SET scheduled_id = recorded.scheduled_id, event_id = recorded.event_id,
            event_channel_id = COALESCE(fixture.event_channel_id, recorded.channel_id),
            state = 'uncertain', error = 'Creation was interrupted after Raid Helper returned an ID. Review the event before proceeding.',
            updated_at = now()
       FROM candidates JOIN wdl_created_events AS recorded ON recorded.id = candidates.recorded_id
      WHERE fixture.fixture_id = candidates.fixture_id AND fixture.state = 'creating'
        AND fixture.scheduled_id IS NULL AND fixture.event_id IS NULL`,
  );
  await query(
    `UPDATE wdl_fixture_events SET state = 'uncertain',
        error = 'Creation was interrupted after Raid Helper returned an ID. Review the event before proceeding.',
        updated_at = now()
      WHERE state = 'creating' AND updated_at < now() - interval '1 minute'
        AND (scheduled_id IS NOT NULL OR event_id IS NOT NULL)`,
  );
}

async function reconcileScheduledWdlEvents() {
  const rows = await query<{ fixture_id: string; state: string; scheduled_id: string; start_time: string; post_at: string; event_channel_id: string | null; member_role_name: string | null; voice_channel_name: string | null }>(
    `SELECT fixture_id, state, scheduled_id, start_time, post_at, event_channel_id, member_role_name, voice_channel_name
       FROM wdl_fixture_events
      WHERE state IN ('scheduled', 'review', 'uncertain') AND scheduled_id IS NOT NULL AND event_id IS NULL`,
  );
  if (!rows.length) return;
  const [posted, scheduled, namesResult] = await Promise.all([
    getPostedWdlEvents(),
    getScheduledWdlEvents(),
    wdlEventNames().then(
      (names) => ({ ok: true as const, names }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
  ]);
  const names = namesResult.ok ? namesResult.names : null;
  for (const row of rows) {
    const channelId = row.event_channel_id ?? WDL_EVENT_CHANNEL;
    const matches = posted.filter((event) => event.scheduledId === row.scheduled_id && event.channelId === channelId);
    if (names && row.state === "scheduled" && ((row.member_role_name && row.member_role_name !== names.role) || (row.voice_channel_name && row.voice_channel_name !== names.voice))) {
      await query("UPDATE wdl_fixture_events SET state = 'review', error = $2, updated_at = now() WHERE fixture_id = $1 AND state = 'scheduled'",
        [row.fixture_id, "The member role or briefing channel was renamed. Raid Helper may still post with the old names; review the scheduled event now."]);
    }
    if (matches.length > 1 && row.state === "scheduled") {
      await query("UPDATE wdl_fixture_events SET state = 'review', error = $2, updated_at = now() WHERE fixture_id = $1 AND state = 'scheduled'",
        [row.fixture_id, "Multiple posted events match the scheduled event. Review in Raid Helper."]);
    } else if (matches.length === 1) {
      const event = await getRawWdlEvent(matches[0]!.id);
      if (event.id !== matches[0]!.id || event.serverId !== "1332320879073296404" || event.channelId !== channelId || event.templateId !== "ct34" ||
          event.scheduledId !== row.scheduled_id || event.startTime !== Number(row.start_time)) {
        await query("UPDATE wdl_fixture_events SET state = 'review', error = $2, updated_at = now() WHERE fixture_id = $1 AND state = 'scheduled'",
          [row.fixture_id, "The posted event did not match the saved schedule. Review in Raid Helper."]);
      } else {
        const recorded = await query(
          `UPDATE wdl_created_events SET event_id = $3, event_verified = true, updated_at = now()
            WHERE fixture_id = $1 AND scheduled_id = $2 AND (event_id IS NULL OR event_id = $3) RETURNING id`,
          [row.fixture_id, row.scheduled_id, event.id],
        );
        const linked = await query(
          `UPDATE wdl_fixture_events
              SET state = CASE WHEN state = 'scheduled' AND $4 THEN 'review' WHEN state = 'scheduled' THEN 'posted' ELSE state END,
                  error = CASE WHEN state = 'scheduled' AND $4 THEN 'The event posted, but its member role and briefing channel names could not be verified. Review it.' ELSE error END,
                  event_id = $3, updated_at = now()
            WHERE fixture_id = $1 AND scheduled_id = $2 AND event_id IS NULL
              AND state IN ('scheduled', 'review', 'uncertain') RETURNING fixture_id`,
          [row.fixture_id, row.scheduled_id, event.id, names === null],
        );
        if (recorded.length && linked.length) {
          await audit({ discordId: "system:wdl", displayName: "WDL fixture worker" }, "wdl.event_posted", "wdl_fixture", row.fixture_id,
            { scheduledId: row.scheduled_id, eventId: event.id });
        }
        if (!namesResult.ok) throw namesResult.error instanceof Error ? namesResult.error : new Error("Could not verify the Discord role and voice channel names.");
      }
    } else if (matches.length === 0 && row.state === "scheduled" && Number(row.post_at) + 300 < Math.floor(Date.now() / 1000) && !scheduled.some((event) => event.id === row.scheduled_id)) {
      await query("UPDATE wdl_fixture_events SET state = 'uncertain', error = $2, updated_at = now() WHERE fixture_id = $1 AND state = 'scheduled'",
        [row.fixture_id, "The scheduled event is no longer listed and no posted event was found. Check Raid Helper before retrying."]);
    }
  }
}

/** Polls fixtures and creates at most one event per pass. Claims are durable before POST. */
export async function wdlFixtureTick() {
  await withLeagueEventLock(runWdlFixtureTick);
}

async function runWdlFixtureTick() {
  await recoverRecordedWdlEventIds();
  await reconcileScheduledWdlEvents();
  const snapshot = await getLeagueFixtures(true);
  if (snapshot.stale) throw new Error(snapshot.error ?? "Wardogs League fixtures are stale.");
  await archiveWdlFixtures(snapshot.data);
  const [settings] = await query<{ enabled: boolean; activation_pending: boolean; baseline_at: Date | null }>(
    "SELECT enabled, activation_pending, baseline_at FROM wdl_raid_settings WHERE id = 1",
  );
  if (!settings) throw new Error("WDL fixture migration has not been applied.");
  if (settings.activation_pending) {
    const baselineCount = await activateWdlRaidAutomation(snapshot.data, true);
    if (baselineCount !== null) {
      await audit({ discordId: "system:wdl", displayName: "WDL fixture worker" }, "wdl.automation_enabled", "wdl", "fixtures",
        { baselineCount, source: "deployment" });
    }
    return;
  }
  if (!settings.enabled) return;
  if (!settings.baseline_at) throw new Error("WDL fixture automation has no initial baseline.");

  const observed = await tx(async (client) => {
    const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_xact_lock($1) AS acquired", [824034]);
    if (!lock.rows[0]?.acquired) return false;
    for (const fixture of [...snapshot.data.upcoming, ...snapshot.data.recent]) {
      const current = await client.query<{ state: string; fixture: WdlFixture; baseline: boolean }>(
        "SELECT state, fixture, baseline FROM wdl_fixture_events WHERE fixture_id = $1 FOR UPDATE", [fixture.id],
      );
      if (!current.rows[0]) {
        if (snapshot.data.upcoming.some((item) => item.id === fixture.id)) {
          await client.query("INSERT INTO wdl_fixture_events (fixture_id, fixture, state) VALUES ($1, $2, 'pending')", [fixture.id, JSON.stringify(fixture)]);
        }
      } else if (!current.rows[0].baseline) {
        const row = current.rows[0];
        if (["scheduled", "posted"].includes(row.state) && fixture.status.toUpperCase() === "COMPLETED") {
          await client.query("UPDATE wdl_fixture_events SET fixture = $2, updated_at = now() WHERE fixture_id = $1", [fixture.id, JSON.stringify(fixture)]);
        } else if (["scheduled", "posted"].includes(row.state) && fixtureChanged(row.fixture, fixture)) {
          await client.query("UPDATE wdl_fixture_events SET fixture = $2, state = 'review', error = $3, updated_at = now() WHERE fixture_id = $1",
            [fixture.id, JSON.stringify(fixture), "WDL changed this fixture. Raid Helper may still post old details; review the linked event now."]);
        } else if (["review", "uncertain"].includes(row.state) && fixtureChanged(row.fixture, fixture)) {
          await client.query("UPDATE wdl_fixture_events SET fixture = $2, updated_at = now() WHERE fixture_id = $1", [fixture.id, JSON.stringify(fixture)]);
        } else if (row.state === "waiting" && fixtureChanged(row.fixture, fixture)) {
          await client.query("UPDATE wdl_fixture_events SET fixture = $2, state = 'pending', error = NULL, updated_at = now() WHERE fixture_id = $1", [fixture.id, JSON.stringify(fixture)]);
        } else if (row.state === "pending") {
          await client.query("UPDATE wdl_fixture_events SET fixture = $2, updated_at = now() WHERE fixture_id = $1", [fixture.id, JSON.stringify(fixture)]);
        }
      }
    }
    return true;
  });

  if (!observed) return;
  const [candidate] = await query<{ fixture_id: string; fixture: WdlFixture }>(
    "SELECT fixture_id, fixture FROM wdl_fixture_events WHERE state = 'pending' AND upper(fixture->>'status') = 'SCHEDULED' ORDER BY updated_at LIMIT 1",
  );
  if (!candidate) return;
  const now = Math.floor(Date.now() / 1000);
  let body: ReturnType<typeof wdlEventBody>;
  try {
    const names = await wdlEventNames();
    await query(
      `UPDATE wdl_fixture_events SET temporary_role = NULL
        WHERE temporary_role IS NOT NULL
          AND (upper(fixture->>'status') = 'COMPLETED'
               OR (fixture->>'scheduledAt')::timestamptz < now() - interval '24 hours')
          AND NOT (lower(temporary_role) = ANY($1::text[]))`,
      [names.roleNames],
    );
    const activeRoles = await query<{ temporary_role: string | null; fixture: WdlFixture }>(
      `SELECT temporary_role, fixture FROM wdl_fixture_events WHERE state IN ('creating', 'scheduled', 'posted', 'review', 'uncertain')
        AND fixture_id <> $1 AND (fixture->>'scheduledAt')::timestamptz > now()`,
      [candidate.fixture_id],
    );
    const [posted, scheduled] = await Promise.all([getPostedWdlEvents(), getScheduledWdlEvents()]);
    const reserved = activeRoles.flatMap((row) => {
      if (row.temporary_role) return [row.temporary_role.toLowerCase()];
      const opponents = fixtureOpponents(row.fixture);
      return opponents ? [`rmnt v ${opponents.join(" v ").toLowerCase()}`] : [];
    });
    for (const event of scheduled) if (event.channelId === WDL_EVENT_CHANNEL) reserved.push(event.title.toLowerCase());
    body = wdlEventBody(candidate.fixture, { ...names, roleNames: [...names.roleNames, ...reserved] }, now);
    const sameTimeGwl = await query(
      `SELECT match_number FROM gwl_raid_events
        WHERE state IN ('creating', 'scheduled', 'posted', 'review', 'uncertain')
          AND start_time IS NOT NULL AND abs(start_time - $1::bigint) < 60 LIMIT 1`, [Number(body.date)],
    );
    const possible = sameTimeGwl.length > 0 || [...posted, ...scheduled].some((event) => possibleWdlEvent(candidate.fixture, Number(body.date), event));
    if (possible) {
      await query("UPDATE wdl_fixture_events SET state = 'review', error = $2, updated_at = now() WHERE fixture_id = $1 AND state = 'pending'",
        [candidate.fixture_id, "A Raid Helper event exists at the same time. Review and link it before creating another."]);
      return;
    }
  } catch (error) {
    if (error instanceof HttpError && ["wdl_fixture_incomplete", "wdl_fixture_late", "wdl_role_collision"].includes(error.code ?? "")) {
      await query("UPDATE wdl_fixture_events SET state = $2, error = $3, updated_at = now() WHERE fixture_id = $1 AND state = 'pending'",
        [candidate.fixture_id, error.code === "wdl_fixture_incomplete" ? "waiting" : "review", error.message]);
      return;
    }
    throw error;
  }
  const latest = await getLeagueFixtures(true);
  if (latest.stale) throw new Error(latest.error ?? "Wardogs League fixtures are stale.");
  const currentFixture = latest.data.upcoming.find((fixture) => fixture.id === candidate.fixture_id);
  if (!currentFixture) {
    await query("UPDATE wdl_fixture_events SET state = 'review', error = $2, updated_at = now() WHERE fixture_id = $1 AND state = 'pending'",
      [candidate.fixture_id, "The fixture is no longer visible in WDL. Review it before creating an event."]);
    return;
  }
  if (fixtureChanged(candidate.fixture, currentFixture)) {
    await query("UPDATE wdl_fixture_events SET fixture = $2, error = $3, updated_at = now() WHERE fixture_id = $1 AND state = 'pending' AND fixture = $4::jsonb",
      [candidate.fixture_id, JSON.stringify(currentFixture), "The fixture changed while it was being checked; it will be re-evaluated.", JSON.stringify(candidate.fixture)]);
    return;
  }
  const sendTime = Math.floor(Date.now() / 1000);
  if (Number(body.date) <= sendTime) {
    await query("UPDATE wdl_fixture_events SET state = 'review', error = $2, updated_at = now() WHERE fixture_id = $1 AND state = 'pending'",
      [candidate.fixture_id, "Briefing has already started; review this fixture manually."]);
    return;
  }
  if (body.schedule !== undefined && body.schedule <= sendTime) {
    const { schedule: _schedule, ...immediate } = body;
    body = immediate;
  } else if (body.schedule !== undefined && body.schedule - sendTime < 20) {
    return;
  }
  let claimed: unknown[];
  try {
    claimed = await independentQuery(
      `UPDATE wdl_fixture_events SET state = 'creating', error = NULL, start_time = $2, post_at = $3, temporary_role = $4, event_channel_id = $8,
          member_role_name = $5, voice_channel_name = $6, updated_at = now()
        WHERE fixture_id = $1 AND state = 'pending' AND fixture = $7::jsonb
          AND EXISTS (SELECT 1 FROM wdl_raid_settings WHERE id = 1 AND enabled)
        RETURNING fixture_id`,
      [candidate.fixture_id, Number(body.date), body.schedule ?? null, body.advancedSettings.temp_role,
        body.advancedSettings.allowed_roles, body.advancedSettings.voice_channel, JSON.stringify(candidate.fixture), WDL_EVENT_CHANNEL],
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      console.warn("WDL temporary role was reserved concurrently; retrying on the next pass.");
      return;
    }
    throw error;
  }
  if (!claimed.length) return;
  try {
    const result = await createWdlRaidEvent(WDL_EVENT_CHANNEL, body);
    const scheduled = body.schedule !== undefined;
    let receipt: { id: string }[];
    try {
      receipt = await independentQuery<{ id: string }>(
        `INSERT INTO wdl_created_events (fixture_id, channel_id, scheduled_id, event_id, origin)
         VALUES ($1, $2, $3, $4, 'automatic') RETURNING id`,
        [candidate.fixture_id, WDL_EVENT_CHANNEL, scheduled ? result.event.id : null, scheduled ? null : result.event.id],
      );
    } catch (error) {
      console.error("Raid Helper returned a WDL event ID that could not be recorded:", {
        fixtureId: candidate.fixture_id, channelId: WDL_EVENT_CHANNEL, raidId: result.event.id, scheduled,
      });
      throw error;
    }
    const saved = await independentQuery(
      `UPDATE wdl_fixture_events SET scheduled_id = $2, event_id = $3, updated_at = now()
        WHERE fixture_id = $1 AND state = 'creating' RETURNING fixture_id`,
      [candidate.fixture_id, scheduled ? result.event.id : null, scheduled ? null : result.event.id],
    );
    if (!saved.length) throw new Error("The fixture changed while the returned Raid Helper ID was being recorded; review it manually.");
    if (!scheduled) {
      const event = await getRawWdlEvent(result.event.id);
      if (event.id !== result.event.id || event.serverId !== "1332320879073296404" || event.channelId !== WDL_EVENT_CHANNEL ||
          event.templateId !== "ct34" || event.startTime !== Number(body.date) || event.title !== body.title) {
        throw new Error("The newly posted event did not match the requested fixture; check Raid Helper.");
      }
      await independentQuery("UPDATE wdl_created_events SET event_verified = true, updated_at = now() WHERE id = $1", [receipt[0]!.id]);
    }
    const completed = await independentQuery(
      `UPDATE wdl_fixture_events SET state = $2, updated_at = now()
        WHERE fixture_id = $1 AND state = 'creating' RETURNING fixture_id`,
      [candidate.fixture_id, scheduled ? "scheduled" : "posted"],
    );
    if (!completed.length) throw new Error("The fixture changed while event creation was being confirmed; review it manually.");
    await audit({ discordId: "system:wdl", displayName: "WDL fixture worker" }, "wdl.event_created", "wdl_fixture", candidate.fixture_id,
      { raidId: result.event.id, scheduled });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Raid Helper error";
    const rejected = error instanceof ProviderError && error.status !== undefined && error.status >= 400 && error.status < 500;
    await independentQuery("UPDATE wdl_fixture_events SET state = $2, error = $3, updated_at = now() WHERE fixture_id = $1 AND state = 'creating'",
      [candidate.fixture_id, rejected ? "review" : "uncertain", message.slice(0, 500)]);
    await audit({ discordId: "system:wdl", displayName: "WDL fixture worker" }, "wdl.event_failed", "wdl_fixture", candidate.fixture_id, { error: message });
    throw new Error(`WDL fixture event creation could not be confirmed: ${message}`);
  }
}

const g = globalThis as unknown as { __wdlFixtureTimer?: NodeJS.Timeout };
export function startWdlFixtureScheduler() {
  if (process.env.NEXT_PHASE === "phase-production-build" || g.__wdlFixtureTimer) return;
  const run = () => void wdlFixtureTick().then(
    () => query("UPDATE wdl_raid_settings SET last_error = NULL WHERE id = 1"),
    (error: Error) => {
      console.error("WDL fixtures:", error.message);
      return query("UPDATE wdl_raid_settings SET last_error = $1 WHERE id = 1", [error.message.slice(0, 500)]);
    },
  ).catch((error: Error) => console.error("Could not record WDL fixture status:", error.message));
  g.__wdlFixtureTimer = setInterval(run, 60_000);
  g.__wdlFixtureTimer.unref();
  setTimeout(run, 30_000).unref();
}
