import { protectedRoute } from "@/lib/apiGuard";
import { HttpError } from "@/lib/http";
import { getClanMembers } from "@/server/services/discord";
import { buildProfile } from "@/server/services/profile";
import { kickMatchSync } from "@/server/services/matchHistory";

export const dynamic = "force-dynamic";

/** One clan member's profile: all-time stats, rank and stored match history. Only clan members linked in Wardogs have a Steam ID to show. */
export const GET = protectedRoute<{ id: string }>(async ({ req, params }) => {
  if (!/^\d{17,20}$/.test(params.id)) throw new HttpError(400, "Invalid Discord ID", "invalid_input");
  const force = req.nextUrl.searchParams.get("refresh") === "1";
  kickMatchSync(force);

  const member = (await getClanMembers(false)).data.find((m) => m.id === params.id);
  if (!member) throw new HttpError(404, "That Discord user is not a clan member", "not_found");
  return buildProfile(member, force);
});