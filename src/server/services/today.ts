import { getEvents } from "./raidHelper";
import { getRoster } from "./rosters";
import { getVoice } from "./voice";
import { BRIEFING_VOICE_CHANNEL_ID } from "./briefing";
import { getPlayerMatches, getStoredTotals, type ProfileMatch } from "./matchHistory";
import { getClanPlayers } from "./compare";
import { mergeBoards } from "@/lib/leaderboardMerge";

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
}

/** Everything the Today page shows for one signed-in user. */
export async function buildToday(discordId: string): Promise<TodayData> {
  const [events, players] = await Promise.all([getEvents().catch(() => null), getClanPlayers().catch(() => [])]);
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
  return { next, voice, latestMatch, rank, linked: !!me };
}
