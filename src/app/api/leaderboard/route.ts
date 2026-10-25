import { z } from "zod";
import { protectedRoute } from "@/lib/apiGuard";
import { resolveLinks } from "@/server/services/links";
import { getLeaderboard } from "@/server/services/wardogsRcon";

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
    const [board, links] = await Promise.all([getLeaderboard(q.range, q.sort, force), resolveLinks().catch(() => null)]);
    return { range: q.range, sort: q.sort, rows: board.data, fetchedAt: board.fetchedAt, stale: board.stale, mySteamId: links?.steamIds.get(session.discordId) ?? null };
  },
  { allowMember: true },
);
