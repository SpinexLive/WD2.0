import { resolveLinks } from "./links";
import { getLeaderboardRanks, getPlayerStats } from "./wardogsRcon";
import { getPlayerMatches, matchSyncStatus, storedMatchCount } from "./matchHistory";

export interface ProfileSubject {
  id: string;
  displayName: string;
  avatarUrl: string;
}

/** One player's all-time stats, rank and stored match history, looked up by their Discord ID (via the Wardogs Discord to Steam links). */
export async function buildProfile(member: ProfileSubject, force: boolean) {
  const links = await resolveLinks();
  const steamId = links.steamIds.get(member.id) ?? null;

  const base = { member: { id: member.id, displayName: member.displayName, avatarUrl: member.avatarUrl }, steamId };
  if (!steamId) return { ...base, stats: null, rank: null, matches: [], history: { ...matchSyncStatus(), ...(await storedMatchCount()) }, errors: [] as string[] };

  const errors: string[] = [];
  const [stats, rank, matches, history] = await Promise.all([
    getPlayerStats(steamId, force).then((s) => (s.stale && errors.push("Player stats may be out of date."), s.data)).catch((e: Error) => (errors.push(`Player stats: ${e.message}`), null)),
    getLeaderboardRanks(force).then((s) => s.data.get(steamId) ?? null).catch(() => null),
    getPlayerMatches(steamId),
    storedMatchCount(),
  ]);

  return { ...base, stats, rank, matches, history: { ...matchSyncStatus(), ...history }, errors };
}
