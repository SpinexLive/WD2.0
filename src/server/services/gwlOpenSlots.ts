import { z } from "zod";
import { audit } from "@/lib/audit";
import { independentQuery, query } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError, ProviderError } from "@/lib/http";
import { getGwlFixtures, getGwlSlots, getGwlTeam, gwlSlotSchema, type GwlFixture } from "./gwl";
import { gwlEventBody, matchesOpenSlot, openSlotEventBody, openSlotFixture, slotFingerprint, type GwlOpenFixture } from "./gwlRaidHelper";
import { deleteLeagueRaidEvent, getRawLeagueEvent, getScheduledLeagueEvent,
  getScheduledLeagueEvents, isLeagueEventChannel, LEAGUE_EVENT_CHANNEL, updateLeagueEvent } from "./leagueRaidHelper";

type Row = {
  match_number: string; fixture: GwlFixture; state: string; scheduled_id: string | null;
  event_id: string | null; event_channel_id: string | null; start_time: string | null; post_at: string | null;
  temporary_role: string | null; member_role_name: string | null; voice_channel_name: string | null;
  error: string | null; updated_at: Date;
};
const actor = { discordId: "system:gwl", displayName: "GWL fixture worker" };
const missing = "GWL open slot is missing; waiting for a second fresh check before removal.";
const updating = "Open-slot event update in progress or unconfirmed; check Raid Helper before taking action.";
const deleting = "Open-slot event deletion in progress or unconfirmed; check Raid Helper before taking action.";
const signupsSchema = z.array(z.object({ id: z.number(), userId: z.string() }));
const matchFingerprint = (fixture: GwlFixture) => JSON.stringify({
  number: fixture.number, status: fixture.status, startsAt: fixture.startsAt, region: fixture.region,
  map: fixture.map, layer: fixture.layer, weather: fixture.weather,
  sides: fixture.sides.map((side) => ({ slug: side.team.slug, tag: side.team.tag, name: side.team.name, faction: side.faction }))
    .sort((a, b) => a.slug.localeCompare(b.slug)),
});

export function readOpenFixture(fixture: GwlFixture): GwlOpenFixture | null {
  if (!("openSlot" in fixture) || !("teamSlug" in fixture)) return null;
  const parsed = gwlSlotSchema.safeParse(fixture.openSlot);
  if (!parsed.success || typeof fixture.teamSlug !== "string" || fixture.number !== `slot:${parsed.data.id}`) return null;
  return { ...fixture, openSlot: parsed.data, teamSlug: fixture.teamSlug };
}

function possibleMatches(open: GwlOpenFixture, fixtures: GwlFixture[]) {
  return fixtures.filter((fixture) => Math.abs(Date.parse(fixture.startsAt) - Date.parse(open.startsAt)) <= 24 * 60 * 60 * 1000
    && fixture.region === open.region && fixture.sides.some((side) => side.team.slug === open.teamSlug));
}

async function review(row: Row, message: string) {
  await query("UPDATE gwl_raid_events SET state = 'review', error = $2, updated_at = now() WHERE match_number = $1 AND state = $3",
    [row.match_number, message, row.state]);
}

async function inspect(row: Row, open: GwlOpenFixture) {
  if (!row.temporary_role || !row.start_time || !row.member_role_name || !row.voice_channel_name ||
      Number(row.start_time) !== Math.floor(Date.parse(open.startsAt) / 1000) - 1800) {
    throw new HttpError(409, "The open-slot event identity is incomplete.", "gwl_slot_unsafe");
  }
  const expected = openSlotEventBody(open, { role: row.member_role_name, voice: row.voice_channel_name, roleNames: [] }, 0);
  const expectedDescription = open.presentationVersion === 2 ? expected.description : expected.description.replace(
    "**Status:** TBD — awaiting teams", `**Open slot:** ${open.openSlot.id}\n**Status:** TBD — awaiting teams`);
  if (row.state === "scheduled" && row.scheduled_id && !row.event_id) {
    const [list, event] = await Promise.all([getScheduledLeagueEvents(), getScheduledLeagueEvent(row.scheduled_id)]);
    const entry = list.find((item) => item.id === row.scheduled_id);
    if (!entry || entry.channelId !== LEAGUE_EVENT_CHANNEL || entry.title !== row.temporary_role ||
        entry.startTime !== Number(row.start_time) || entry.postTime !== Number(row.post_at) ||
        event.serverId !== env().DISCORD_GUILD_ID || event.channelId !== row.scheduled_id ||
        event.title !== row.temporary_role || event.templateId !== "ct34" || event.interval !== "0 days" ||
        event.startTime !== Number(row.start_time) || event.postTime !== Number(row.post_at) ||
        event.description !== expectedDescription) {
      throw new HttpError(409, "The scheduled open-slot event could not be verified.", "gwl_slot_unsafe");
    }
    return { id: row.scheduled_id, scheduled: true, description: event.description, signups: null };
  }
  if (row.state === "posted" && row.event_id && row.event_channel_id) {
    const event = await getRawLeagueEvent(row.event_id);
    const signups = signupsSchema.safeParse(event.signUps);
    if (event.id !== row.event_id || event.serverId !== env().DISCORD_GUILD_ID || event.channelId !== row.event_channel_id ||
        !(await isLeagueEventChannel(event.channelId)) || event.templateId !== "ct34" ||
        event.title !== row.temporary_role || event.startTime !== Number(row.start_time) ||
        event.description !== expectedDescription || !signups.success) {
      throw new HttpError(409, "The posted open-slot event or its signups could not be verified.", "gwl_slot_unsafe");
    }
    return { id: row.event_id, scheduled: false, description: event.description, signups: signups.data };
  }
  throw new HttpError(409, "The open-slot event is not in a safely editable state.", "gwl_slot_unsafe");
}

async function freshMatches(open: GwlOpenFixture) {
  const [slots, fixtures] = await Promise.all([getGwlSlots(true), getGwlFixtures(true)]);
  if (slots.stale || fixtures.stale) throw new Error(slots.error ?? fixtures.error ?? "GWL data is stale.");
  return { slots: slots.data.slots, fixtures: fixtures.data.upcoming };
}

async function updateOpenEvent(row: Row, open: GwlOpenFixture, next: GwlFixture, isSlot: boolean) {
  if (Date.parse(next.startsAt) !== Date.parse(open.startsAt)) {
    throw new HttpError(409, "The GWL start time changed; review the Raid Helper event manually.", "gwl_slot_unsafe");
  }
  if (!isSlot && (await query("SELECT match_number FROM gwl_raid_events WHERE match_number = $1", [next.number])).length) {
    throw new HttpError(409, "A GWL event record already exists for this match; review both records.", "gwl_slot_unsafe");
  }
  const old = await inspect(row, open);
  const current = await freshMatches(open);
  if (isSlot) {
    const slot = current.slots.find((item) => item.id === open.openSlot.id);
    if (!slot || slotFingerprint(slot) !== slotFingerprint((next as GwlOpenFixture).openSlot)) {
      throw new HttpError(409, "The GWL slot changed during the event update.", "gwl_slot_unsafe");
    }
  } else {
    const candidates = possibleMatches(open, current.fixtures);
    if (current.slots.some((slot) => slot.id === open.openSlot.id) || candidates.length !== 1 ||
        matchFingerprint(candidates[0]!) !== matchFingerprint(next) || !matchesOpenSlot(open, candidates[0]!)) {
      throw new HttpError(409, "The GWL match could not be uniquely verified.", "gwl_slot_unsafe");
    }
  }
  const again = await inspect(row, open);
  if (again.id !== old.id || again.description !== old.description ||
      JSON.stringify(again.signups) !== JSON.stringify(old.signups)) {
    throw new HttpError(409, "The event or signups changed during the update checks.", "gwl_slot_unsafe");
  }
  const names = { role: row.member_role_name!, voice: row.voice_channel_name!, roleNames: [] };
  const body = isSlot ? openSlotEventBody(next as GwlOpenFixture, names, Math.floor(Date.now() / 1000))
    : gwlEventBody(next, names, Math.floor(Date.now() / 1000));
  const claimed = await independentQuery(
    `UPDATE gwl_raid_events SET state = 'uncertain', error = $3, updated_at = now()
     WHERE match_number = $1 AND state = $2 AND fixture = $4::jsonb RETURNING match_number`,
    [row.match_number, row.state, updating, JSON.stringify(row.fixture)],
  );
  if (!claimed.length) return false;
  await audit(actor, "gwl.slot_update_started", "gwl_slot", open.openSlot.id, { eventId: old.id });
  try {
    await updateLeagueEvent(old.id, { title: body.title, description: body.description });
    if (old.scheduled) {
      const [entry, event] = await Promise.all([getScheduledLeagueEvents(), getScheduledLeagueEvent(old.id)]);
      const saved = entry.find((item) => item.id === old.id);
      if (!saved || saved.channelId !== LEAGUE_EVENT_CHANNEL || saved.title !== body.title ||
          saved.startTime !== Number(row.start_time) || saved.postTime !== Number(row.post_at) ||
          event.serverId !== env().DISCORD_GUILD_ID || event.channelId !== old.id || event.interval !== "0 days" ||
          event.templateId !== "ct34" || event.postTime !== Number(row.post_at) ||
          event.title !== body.title || event.description !== body.description || event.startTime !== Number(row.start_time)) {
        throw new Error("The updated schedule could not be verified.");
      }
    } else {
      const event = await getRawLeagueEvent(old.id);
      const signups = signupsSchema.safeParse(event.signUps);
      if (event.id !== old.id || event.serverId !== env().DISCORD_GUILD_ID || event.channelId !== row.event_channel_id ||
          event.templateId !== "ct34" || event.startTime !== Number(row.start_time) || event.title !== body.title ||
          event.description !== body.description || !signups.success || !old.signups ||
          old.signups.some((signup) => !signups.data.some((item) => item.id === signup.id && item.userId === signup.userId))) {
        throw new Error("The updated event or its existing signups could not be verified.");
      }
    }
    const saved = await independentQuery(
      `UPDATE gwl_raid_events SET match_number = $2, fixture = $3, temporary_role = $4, state = $5, error = NULL, updated_at = now()
       WHERE match_number = $1 AND state = 'uncertain' AND error = $6
         AND NOT EXISTS (SELECT 1 FROM gwl_raid_events WHERE match_number = $2 AND match_number <> $1) RETURNING match_number`,
      [row.match_number, next.number, JSON.stringify(next), body.title, row.state, updating],
    );
    if (!saved.length) throw new Error("The verified event update could not be recorded.");
  } catch (error) {
    await audit(actor, "gwl.slot_update_uncertain", "gwl_slot", open.openSlot.id, { eventId: old.id });
    throw new Error(`GWL open-slot update could not be confirmed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  await audit(actor, "gwl.slot_updated", "gwl_slot", open.openSlot.id, { eventId: old.id, matchNumber: isSlot ? null : next.number });
  return true;
}

async function deleteOpenEvent(row: Row, open: GwlOpenFixture) {
  const old = await inspect(row, open);
  const fresh = await freshMatches(open);
  if (fresh.slots.some((slot) => slot.id === open.openSlot.id) || possibleMatches(open, fresh.fixtures).length) return;
  const again = await inspect(row, open);
  if (again.id !== old.id || again.description !== old.description || JSON.stringify(again.signups) !== JSON.stringify(old.signups)) {
    throw new HttpError(409, "The event changed during deletion checks.", "gwl_slot_unsafe");
  }
  const claimed = await independentQuery(
    `UPDATE gwl_raid_events SET state = 'uncertain', error = $3, updated_at = now()
     WHERE match_number = $1 AND state = $2 AND fixture = $4::jsonb RETURNING match_number`,
    [row.match_number, row.state, deleting, JSON.stringify(row.fixture)],
  );
  if (!claimed.length) return;
  await audit(actor, "gwl.slot_deletion_started", "gwl_slot", open.openSlot.id, { eventId: old.id });
  try {
    let deletionError: unknown;
    try { await deleteLeagueRaidEvent(old.id); } catch (error) { deletionError = error; }
    try {
      if (old.scheduled) await getScheduledLeagueEvent(old.id);
      else await getRawLeagueEvent(old.id);
      throw new Error("Raid Helper still returns the event.");
    } catch (error) {
      if (!(error instanceof ProviderError && error.provider === "raid-helper" && error.status === 404)) throw error;
    }
    if (old.scheduled && (await getScheduledLeagueEvents()).some((event) => event.id === old.id)) {
      throw new Error("Raid Helper still lists the scheduled event.");
    }
    const saved = await independentQuery(
      "UPDATE gwl_raid_events SET state = 'cancelled', error = NULL, updated_at = now() WHERE match_number = $1 AND state = 'uncertain' AND error = $2 RETURNING match_number",
      [row.match_number, deleting],
    );
    if (!saved.length) throw new Error("The confirmed event deletion could not be recorded.");
    await audit(actor, "gwl.slot_deleted", "gwl_slot", open.openSlot.id, { eventId: old.id, responseConfirmed: deletionError === undefined });
  } catch (error) {
    await audit(actor, "gwl.slot_deletion_uncertain", "gwl_slot", open.openSlot.id, { eventId: old.id });
    throw new Error(`GWL open-slot deletion could not be confirmed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

export async function processOpenSlots(fixtures: GwlFixture[], recent: GwlFixture[] = []): Promise<Set<string>> {
  const [slots, team, rows] = await Promise.all([
    getGwlSlots(true), getGwlTeam(), query<Row>("SELECT * FROM gwl_raid_events WHERE match_number LIKE 'slot:%'"),
  ]);
  if (slots.stale || team.stale) throw new Error(slots.error ?? team.error ?? "GWL slot or team data is stale.");
  const seenTags = new Map<string, Set<string>>();
  for (const fixture of [...fixtures, ...recent]) {
    for (const side of fixture.sides) {
      const tag = side.team.tag?.trim();
      if (!tag || !/^[A-Za-z0-9_-]{1,30}$/.test(tag)) continue;
      const tags = seenTags.get(side.team.slug) ?? new Set<string>();
      tags.add(tag.toUpperCase());
      seenTags.set(side.team.slug, tags);
    }
  }
  const tags = new Map([...seenTags].filter(([, values]) => values.size === 1).map(([slug, values]) => [slug, [...values][0]!]));
  for (const row of rows) {
    const stored = readOpenFixture(row.fixture);
    if (!stored) continue;
    for (const side of stored.sides) {
      const { slug, tag } = side.team;
      if (!seenTags.has(slug) && tag && tag !== slug && /^[A-Za-z0-9_-]{1,30}$/.test(tag)) tags.set(slug, tag);
    }
  }
  const openFixtures = slots.data.slots.map((slot) => openSlotFixture(slot, team.data, tags));
  const blocked = new Set<string>();
  for (const row of rows) {
    const open = readOpenFixture(row.fixture);
    if (!open) throw new Error("A stored GWL open slot has invalid identity data.");
    const candidates = possibleMatches(open, fixtures);
    for (const fixture of candidates) blocked.add(fixture.number);
    const current = openFixtures.find((item) => item.openSlot.id === open.openSlot.id);
    if (current) {
      if (row.state === "cancelled") {
        await review(row, "This removed GWL slot is visible again. Review before creating another event.");
      } else if (slotFingerprint(current.openSlot) !== slotFingerprint(open.openSlot) ||
          open.presentationVersion !== current.presentationVersion ||
          current.sides.some((side, index) => side.team.tag !== open.sides[index]?.team.tag)) {
        if (row.state === "pending" || row.state === "waiting") {
          await query("UPDATE gwl_raid_events SET fixture = $2, state = 'pending', error = NULL, updated_at = now() WHERE match_number = $1 AND state = $3",
            [row.match_number, JSON.stringify(current), row.state]);
        } else if (row.state === "posted" || row.state === "scheduled") {
          try { await updateOpenEvent(row, open, current, true); } catch (error) {
            if (error instanceof HttpError && error.code === "gwl_slot_unsafe") await review(row, error.message);
            else throw error;
          }
        }
      } else if (row.state === "review" && row.error === missing) {
        await query("UPDATE gwl_raid_events SET state = $2, error = NULL, updated_at = now() WHERE match_number = $1 AND state = 'review' AND error = $3",
          [row.match_number, row.event_id ? "posted" : row.scheduled_id ? "scheduled" : "pending", missing]);
      }
      continue;
    }
    if (row.state === "cancelled" || row.state === "uncertain" || row.state === "creating") continue;
    const matches = candidates.filter((fixture) => matchesOpenSlot(open, fixture));
    const competitors = rows.filter((other) => {
      const otherOpen = readOpenFixture(other.fixture);
      return other.match_number !== row.match_number && otherOpen && matches.length === 1 && matchesOpenSlot(otherOpen, matches[0]!);
    });
    const competingSlots = openFixtures.filter((other) => other.number !== row.match_number &&
      matches.length === 1 && matchesOpenSlot(other, matches[0]!));
    if (candidates.length && (matches.length !== 1 || candidates.length !== 1 || competitors.length || competingSlots.length)) {
      if (row.state !== "review") await review(row, "The GWL slot may have become a match, but its identity is ambiguous. Review before deleting or creating events.");
      continue;
    }
    if (matches.length === 1) {
      const match = matches[0]!;
      if (row.state === "pending" || row.state === "waiting") {
        const moved = await query(
          `UPDATE gwl_raid_events SET match_number = $2, fixture = $3, state = 'pending', error = NULL, updated_at = now()
           WHERE match_number = $1 AND state = $4 AND NOT EXISTS (SELECT 1 FROM gwl_raid_events WHERE match_number = $2) RETURNING match_number`,
          [row.match_number, match.number, JSON.stringify(match), row.state]);
        if (moved.length) blocked.delete(match.number);
      } else if (row.state === "posted" || row.state === "scheduled" || (row.state === "review" && row.error === missing)) {
        const active = row.state === "review" ? { ...row, state: row.event_id ? "posted" : "scheduled" } : row;
        if (row.state === "review") {
          const restored = await query("UPDATE gwl_raid_events SET state = $2, error = NULL WHERE match_number = $1 AND state = 'review' AND error = $3 RETURNING match_number",
            [row.match_number, active.state, missing]);
          if (!restored.length) continue;
        }
        try {
          if (await updateOpenEvent(active, open, match, false)) blocked.delete(match.number);
        } catch (error) {
          if (error instanceof HttpError && error.code === "gwl_slot_unsafe") await review(active, error.message);
          else throw error;
        }
      }
      continue;
    }
    if (Date.parse(open.startsAt) <= Date.now()) continue;
    if (row.state === "pending" || row.state === "waiting") {
      await query("UPDATE gwl_raid_events SET state = 'cancelled', error = NULL, updated_at = now() WHERE match_number = $1 AND state = $2", [row.match_number, row.state]);
    } else if (row.state === "posted" || row.state === "scheduled") {
      await review(row, missing);
    } else if (row.state === "review" && row.error === missing && Date.now() - new Date(row.updated_at).getTime() >= 60_000) {
      const active = { ...row, state: row.event_id ? "posted" : row.scheduled_id ? "scheduled" : "review" };
      if (active.state === "review") continue;
      const restored = await query("UPDATE gwl_raid_events SET state = $2, error = NULL WHERE match_number = $1 AND state = 'review' AND error = $3 RETURNING match_number", [row.match_number, active.state, missing]);
      if (!restored.length) continue;
      try { await deleteOpenEvent(active, open); } catch (error) {
        if (error instanceof HttpError && error.code === "gwl_slot_unsafe") await review(active, error.message);
        else throw error;
      }
    }
  }
  for (const open of openFixtures) {
    if (!rows.some((row) => row.match_number === open.number)) {
      const candidates = possibleMatches(open, fixtures);
      if (candidates.length) {
        for (const fixture of candidates) blocked.add(fixture.number);
        await query("INSERT INTO gwl_raid_events (match_number, fixture, state, error) VALUES ($1, $2, 'review', $3) ON CONFLICT DO NOTHING",
          [open.number, JSON.stringify(open), "An open slot and possible match are both visible. Review before creating events."]);
        continue;
      }
    }
    await query("INSERT INTO gwl_raid_events (match_number, fixture, state) VALUES ($1, $2, 'pending') ON CONFLICT DO NOTHING",
      [open.number, JSON.stringify(open)]);
  }
  return blocked;
}
