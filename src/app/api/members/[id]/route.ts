import { protectedRoute } from "@/lib/apiGuard";
import { HttpError } from "@/lib/http";
import { getClanMembers } from "@/server/services/discord";
import { resolveLinks } from "@/server/services/links";
import { getLeaderboardRanks, getPlayerStats } from "@/server/services/wardogsRcon";
import { getPlayerMatches, kickMatchSync, matchSyncStatus, storedMatchCount } from "@/server/services/matchHistory";

export const dynamic = "force-dynamic";

/** One clan member's profile: all-time stats, rank and stored match history. Only clan members linked in Wardogs have a Steam ID to show. */
export const GET = protectedRoute<{ id: string }>(async ({ req, params }) => {
  if (!/^\d{17,20}$/.test(params.id)) throw new HttpError(400, "Invalid Discord ID", "invalid_input");
  const force = req.nextUrl.searchParams.get("refresh") === "1";
  kickMatchSync(force);

  const [clan, links] = await Promise.all([getClanMembers(false), resolveLinks()]);
  const member = clan.data.find((m) => m.id === params.id);
  if (!member) throw new HttpError(404, "That Discord user is not a clan member", "not_found");
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
});
