import { protectedRoute } from "@/lib/apiGuard";
import { HttpError } from "@/lib/http";
import { buildCompare, getClanPlayers } from "@/server/services/compare";

export const dynamic = "force-dynamic";

/**
 * Without `with`: the list of clan members you can compare against. With `with=clan|<discordId>`: per-match series and totals.
 * Staff may pass `subject` to compare someone else; everyone else always compares themselves.
 */
export const GET = protectedRoute(
  async ({ req, session }) => {
    const sp = req.nextUrl.searchParams;
    const subjectId = session.isAdmin && sp.get("subject") ? sp.get("subject")! : session.discordId;
    const players = await getClanPlayers();
    const subject = players.find((p) => p.discordId === subjectId);
    const options = players.filter((p) => p.discordId !== subjectId).map((p) => ({ id: p.discordId, name: p.name }));
    const withKey = sp.get("with");
    if (!withKey) return { options };
    if (!subject) throw new HttpError(404, "No linked Steam account to compare", "no_steam");
    const result = await buildCompare(subject, withKey, players);
    if (!result) throw new HttpError(404, "That player can't be compared", "not_found");
    return result;
  },
  { allowMember: true },
);
