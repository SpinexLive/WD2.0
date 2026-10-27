import type { LeaderboardRow, LeaderboardSort } from "@/server/services/wardogsRcon";

export const MIN_KD_MATCHES = 5;

/**
 * Combines the Wardogs API rows (server-wide top 100 only) with totals from our stored matches.
 * Per player the source covering more matches wins, so nobody is dropped just for missing the API's top 100.
 */
export function mergeBoards(sources: LeaderboardRow[][], keep: (steamId: string) => boolean, sort: LeaderboardSort): LeaderboardRow[] {
  const best = new Map<string, LeaderboardRow>();
  for (const r of sources.flat()) {
    if (!keep(r.steamId)) continue;
    const cur = best.get(r.steamId);
    if (!cur || r.matches > cur.matches || (r.matches === cur.matches && r.kills > cur.kills)) best.set(r.steamId, r);
  }
  const value = (r: LeaderboardRow) => (sort === "kd" ? r.kd : sort === "cash" ? (r.cash ?? 0) : sort === "matches" ? r.matches : r.kills);
  return [...best.values()]
    .filter((r) => sort !== "kd" || r.matches >= MIN_KD_MATCHES)
    .sort((a, b) => value(b) - value(a) || b.kills - a.kills)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
