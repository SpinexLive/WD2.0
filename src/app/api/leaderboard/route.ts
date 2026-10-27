import { z } from "zod";
import { protectedRoute } from "@/lib/apiGuard";
import { resolveLinks } from "@/server/services/links";
import { getAllClanMembers, getClanMembers } from "@/server/services/discord";
import { getLeaderboard, MIN_KD_MATCHES } from "@/server/services/wardogsRcon";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  range: z.enum(["7d", "30d", "all"]).default("30d"),
  sort: z.enum(["kills", "kd", "cash", "matches"]).default("kills"),
});

/** Game-server leaderboard, open to members and admins. Only the caller's own Steam ID (from their session) is used to mark their row. */
export const GET = protectedRoute(
  async ({ req, session }) => {
    const q = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const force = req.nextUrl.searchParams.get("refresh") === "1";
    // The API caps each list at the server-wide top 100, so a single sort holds few clan members. Pool several lists, then sort locally.
    const [pools, links, clan, allClan] = await Promise.all([
      Promise.all((["kills", "cash", "matches"] as const).map((s) => getLeaderboard(q.range, s, force))),
      resolveLinks().catch(() => null),
      getClanMembers().then((s) => s.data, () => []),
      getAllClanMembers().then((s) => s.data, () => []),
    ]);
    // Linked players are shown by their Discord nickname; everyone else keeps their in-game name.
    const nick = new Map<string, string>();
    if (links) {
      const byDiscord = new Map([...allClan, ...clan].map((m) => [m.id, m.displayName]));
      for (const [discordId, steamId] of links.steamIds) {
        const name = byDiscord.get(discordId);
        if (name) nick.set(steamId, name);
      }
    }
    // Clan members only (linked to a Discord member with the clan or Wardogs role), ranked within the clan.
    const merged = new Map(pools.flatMap((p) => p.data).map((r) => [r.steamId, r]));
    const value = (r: { kills: number; kd: number; cash: number | null; matches: number }) => (q.sort === "kd" ? r.kd : q.sort === "cash" ? (r.cash ?? 0) : q.sort === "matches" ? r.matches : r.kills);
    const rows = [...merged.values()]
      .filter((r) => nick.has(r.steamId) && (q.sort !== "kd" || r.matches >= MIN_KD_MATCHES))
      .sort((a, b) => value(b) - value(a) || b.kills - a.kills)
      .map((r, i) => ({ ...r, nickname: nick.get(r.steamId)!, rank: i + 1 }));
    const board = { fetchedAt: pools[0]!.fetchedAt, stale: pools.some((p) => p.stale) };
    return { range: q.range, sort: q.sort, rows, fetchedAt: board.fetchedAt, stale: board.stale, mySteamId: links?.steamIds.get(session.discordId) ?? null };
  },
  { allowMember: true },
);
