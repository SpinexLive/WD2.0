import { z } from "zod";
import { protectedRoute } from "@/lib/apiGuard";
import { resolveLinks } from "@/server/services/links";
import { getAllClanMembers, getClanMembers } from "@/server/services/discord";
import { getLeaderboard } from "@/server/services/wardogsRcon";
import { getStoredTotals, kickMatchSync } from "@/server/services/matchHistory";
import { mergeBoards } from "@/lib/leaderboardMerge";
import { ProviderError } from "@/lib/http";

export const dynamic = "force-dynamic";

const RANGE_DAYS = { "7d": 7, "30d": 30, all: null } as const;
const querySchema = z.object({
  range: z.enum(["7d", "30d", "all"]).default("30d"),
  sort: z.enum(["kills", "kd", "cash", "matches"]).default("kills"),
});

/** Game-server leaderboard, open to members and admins. Only the caller's own Steam ID (from their session) is used to mark their row. */
export const GET = protectedRoute(
  async ({ req, session }) => {
    const q = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const force = req.nextUrl.searchParams.get("refresh") === "1";
    // The API caps each list at the server-wide top 100, so it is pooled with totals from our own stored matches; the source covering more matches wins per player.
    const [pools, links, clan, allClan] = await Promise.all([
      Promise.all((["kills", "cash", "matches"] as const).map((s) => getLeaderboard(q.range, s, force).catch(() => null))),
      resolveLinks().catch(() => null),
      getClanMembers().then((s) => s.data, () => []),
      getAllClanMembers().then((s) => s.data, () => []),
    ]);
    // Linked players are shown by their Discord nickname.
    const nick = new Map<string, string>();
    if (links) {
      const byDiscord = new Map([...allClan, ...clan].map((m) => [m.id, m.displayName]));
      for (const [discordId, steamId] of links.steamIds) {
        const name = byDiscord.get(discordId);
        if (name) nick.set(steamId, name);
      }
    }
    kickMatchSync();
    const stored = await getStoredTotals([...nick.keys()], RANGE_DAYS[q.range]);
    const live = pools.flatMap((p) => (p ? [p] : []));
    if (live.length === 0 && stored.length === 0) throw new ProviderError("wardogs-rcon", "Leaderboard data is unavailable right now.");
    const rows = mergeBoards([...live.map((p) => p.data), stored], (id) => nick.has(id), q.sort).map((r) => ({ ...r, nickname: nick.get(r.steamId)! }));
    return { range: q.range, sort: q.sort, rows, fetchedAt: live[0]?.fetchedAt ?? new Date().toISOString(), stale: live.length < pools.length || live.some((p) => p.stale), mySteamId: links?.steamIds.get(session.discordId) ?? null };
  },
  { allowMember: true },
);
