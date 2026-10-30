import { query, tx } from "@/lib/db";
import { getEvents } from "./raidHelper";
import { getRoster } from "./rosters";
import { getVoice } from "./voice";
import { gatewayReady } from "./rosterGateway";
import { BRIEFING_VOICE_CHANNEL_ID } from "./briefing";

const WINDOW_S = 10 * 60;

/** Records who was in the briefing voice channel for every rostered event that started in the last 10 minutes and hasn't been recorded yet. Runs every minute. */
export async function snapshotAttendance(): Promise<void> {
  if (!gatewayReady()) return;
  const now = Math.floor(Date.now() / 1000);
  const events = (await getEvents()).data.filter((e) => e.startTime !== null && e.startTime <= now && e.startTime > now - WINDOW_S);
  if (events.length === 0) return;
  const done = new Set((await query<{ event_id: string }>("SELECT event_id FROM attendance_events WHERE event_id = ANY($1::text[])", [events.map((e) => e.id)])).map((r) => r.event_id));
  const present = new Set(getVoice()?.channels.find((c) => c.id === BRIEFING_VOICE_CHANNEL_ID)?.userIds ?? []);

  for (const e of events) {
    if (done.has(e.id)) continue;
    const roster = await getRoster(e.id);
    if (!roster) continue;
    const players = roster.squads.flatMap((s) => s.slots.flatMap((p) => (p?.discordId ? [{ id: p.discordId, name: p.displayName, response: roster.responses[p.discordId] ?? null }] : [])));
    await tx(async (c) => {
      await c.query("INSERT INTO attendance_events (event_id, title, starts_at, rostered, in_voice) VALUES ($1,$2,to_timestamp($3),$4,$5) ON CONFLICT DO NOTHING", [e.id, e.title, e.startTime, players.length, players.filter((p) => present.has(p.id)).length]);
      for (const p of players) {
        await c.query("INSERT INTO attendance (event_id, discord_id, display_name, response, present) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [e.id, p.id, p.name, p.response, present.has(p.id)]);
      }
    });
  }
}

export interface AttendanceMember {
  discordId: string;
  name: string;
  rostered: number;
  attended: number;
  declined: number;
  noShows: number;
  /** Attended over the events they didn't decline, as a percentage; null when they declined everything. */
  rate: number | null;
}

export interface AttendanceEvent {
  eventId: string;
  title: string;
  startsAt: string;
  rostered: number;
  inVoice: number;
  noShows: string[];
}

export async function getAttendanceReport(days: number | null) {
  const since = "($1::int IS NULL OR e.starts_at >= now() - make_interval(days => $1::int))";
  const [members, events, noShowRows] = await Promise.all([
    query<{ discord_id: string; name: string; rostered: string; attended: string; declined: string; no_shows: string }>(
      `SELECT a.discord_id, (array_agg(a.display_name ORDER BY e.starts_at DESC))[1] AS name, count(*) AS rostered,
              count(*) FILTER (WHERE a.present) AS attended,
              count(*) FILTER (WHERE a.response = 'declined') AS declined,
              count(*) FILTER (WHERE NOT a.present AND COALESCE(a.response, '') <> 'declined') AS no_shows
         FROM attendance a JOIN attendance_events e ON e.event_id = a.event_id WHERE ${since} GROUP BY a.discord_id`,
      [days],
    ),
    query<{ event_id: string; title: string; starts_at: Date; rostered: number; in_voice: number }>(
      `SELECT e.event_id, e.title, e.starts_at, e.rostered, e.in_voice FROM attendance_events e WHERE ${since} ORDER BY e.starts_at DESC LIMIT 25`,
      [days],
    ),
    query<{ event_id: string; display_name: string }>(
      `SELECT a.event_id, a.display_name FROM attendance a JOIN attendance_events e ON e.event_id = a.event_id
        WHERE ${since} AND NOT a.present AND COALESCE(a.response, '') <> 'declined' ORDER BY a.display_name`,
      [days],
    ),
  ]);
  const missing = new Map<string, string[]>();
  for (const r of noShowRows) missing.set(r.event_id, [...(missing.get(r.event_id) ?? []), r.display_name]);

  const outMembers: AttendanceMember[] = members
    .map((m) => {
      const rostered = Number(m.rostered);
      const declined = Number(m.declined);
      const attended = Number(m.attended);
      const eligible = rostered - declined;
      return { discordId: m.discord_id, name: m.name, rostered, attended, declined, noShows: Number(m.no_shows), rate: eligible > 0 ? Math.round((attended / eligible) * 100) : null };
    })
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.attended - a.attended);
  const outEvents: AttendanceEvent[] = events.map((e) => ({ eventId: e.event_id, title: e.title, startsAt: e.starts_at.toISOString(), rostered: e.rostered, inVoice: e.in_voice, noShows: missing.get(e.event_id) ?? [] }));
  return { members: outMembers, events: outEvents };
}
export type AttendanceReport = Awaited<ReturnType<typeof getAttendanceReport>>;
