import { getEvents } from "./raidHelper";
import { getRoster } from "./rosters";
import { getVoice } from "./voice";
import { BRIEFING_VOICE_CHANNEL_ID } from "./briefing";
import { getPlayerMatches, getStoredTotals, type ProfileMatch } from "./matchHistory";
import { getClanPlayers } from "./compare";
import { mergeBoards } from "@/lib/leaderboardMerge";
import { getGwlFixtures, nextGwlFixture, type GwlFixture } from "./gwl";
import { query } from "@/lib/db";
import { env } from "@/lib/env";

const LOOKBACK_S = 2 * 3600;

export interface TodayData {
  next: {
    eventId: string;
    title: string;
    startTime: number;
    rostered: boolean;
    squad: string | null;
    isLeader: boolean;
    response: "accepted" | "declined" | null;
    published: boolean;
  } | null;
  voice: { available: boolean; inChannel: string | null; briefingCount: number };
  latestMatch: ProfileMatch | null;
  rank: { rank: number; of: number; kills: number } | null;
  linked: boolean;
  gwl: { fixture: GwlFixture | null; stale: boolean; error: string | null; eventUrl: string | null } | null;
}

/** Everything the Today page shows for one signed-in user. */
export async function buildToday(discordId: string): Promise<TodayData> {
  const [events, players, gwl] = await Promise.all([
    getEvents().catch(() => null),
    getClanPlayers().catch(() => []),
    env().GWL_API_KEY ? getGwlFixtures().then((snapshot) => ({
      fixture: nextGwlFixture(snapshot.data.upcoming),
      stale: snapshot.stale,
      error: snapshot.stale ? snapshot.error ?? "Using older fixture data." : null,
    }), (error: unknown) => ({ fixture: null, stale: false, error: error instanceof Error ? error.message : "Could not load GWL fixtures." })) : null,
  ]);
  const [gwlEvent] = gwl?.fixture ? await query<{ event_id: string; event_channel_id: string }>(
    "SELECT event_id, event_channel_id FROM gwl_raid_events WHERE match_number = $1 AND state = 'posted' AND event_id IS NOT NULL AND event_channel_id IS NOT NULL", [gwl.fixture.number],
  ) : [];
  const gwlEventUrl = gwlEvent ? `https://discord.com/channels/${env().DISCORD_GUILD_ID}/${gwlEvent.event_channel_id}/${encodeURIComponent(gwlEvent.event_id)}` : null;
  const cutoff = Math.floor(Date.now() / 1000) - LOOKBACK_S;
  const upcoming = (events?.data ?? []).filter((e) => e.startTime !== null && e.startTime >= cutoff).sort((a, b) => a.startTime! - b.startTime!);

  let next: TodayData["next"] = null;
  for (const e of upcoming) {
    const roster = await getRoster(e.id);
    const squad = roster?.squads.find((s) => s.slots.some((p) => p?.discordId === discordId));
    if (roster && squad) {
      const raw = roster.responses[discordId];
      next = {
        eventId: e.id,
        title: e.title,
        startTime: e.startTime!,
        rostered: true,
        squad: squad.name,
        isLeader: !!squad.slots.find((p) => p?.discordId === discordId)?.isLeader,
        response: raw === "accepted" || raw === "declined" ? raw : null,
        published: roster.status === "published",
      };
      break;
    }
    next ??= { eventId: e.id, title: e.title, startTime: e.startTime!, rostered: false, squad: null, isLeader: false, response: null, published: roster?.status === "published" };
  }

  const v = getVoice();
  const here = v?.channels.find((c) => c.userIds.includes(discordId));
  const voice = { available: v !== null, inChannel: here?.name ?? null, briefingCount: v?.channels.find((c) => c.id === BRIEFING_VOICE_CHANNEL_ID)?.userIds.length ?? 0 };

  const me = players.find((p) => p.discordId === discordId);
  let latestMatch: ProfileMatch | null = null;
  let rank: TodayData["rank"] = null;
  if (me) {
    latestMatch = (await getPlayerMatches(me.steamId))[0] ?? null;
    const ids = new Set(players.map((p) => p.steamId));
    const board = mergeBoards([await getStoredTotals([...ids], 30)], (id) => ids.has(id), "kills");
    const row = board.find((r) => r.steamId === me.steamId);
    if (row) rank = { rank: row.rank, of: board.length, kills: row.kills };
  }
  return { next, voice, latestMatch, rank, linked: !!me, gwl: gwl ? { ...gwl, eventUrl: gwlEventUrl } : null };
}
