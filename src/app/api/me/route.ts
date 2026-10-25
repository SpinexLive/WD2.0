import { protectedRoute } from "@/lib/apiGuard";
import { buildProfile } from "@/server/services/profile";
import { kickMatchSync } from "@/server/services/matchHistory";
import { getLeagueApplications, getLeagueMembers, registrationStatus } from "@/server/services/wardogsLeague";

export const dynamic = "force-dynamic";

/** The signed-in user's own stats. The Discord ID comes from the session, never from the request, so nobody can read another player's page here. */
export const GET = protectedRoute(
  async ({ req, session }) => {
    const force = req.nextUrl.searchParams.get("refresh") === "1";
    kickMatchSync(force);
    const profile = await buildProfile({ id: session.discordId, displayName: session.displayName, avatarUrl: session.avatarUrl }, force);
    const [members, apps] = await Promise.all([getLeagueMembers(force).catch(() => null), getLeagueApplications(force).catch(() => null)]);
    const registration = registrationStatus(session.discordId, members?.data ?? null, apps?.data ?? null);
    return { ...profile, registration };
  },
  { allowMember: true },
);
