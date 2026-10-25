import { protectedRoute } from "@/lib/apiGuard";
import { buildProfile } from "@/server/services/profile";
import { kickMatchSync } from "@/server/services/matchHistory";

export const dynamic = "force-dynamic";

/** The signed-in user's own stats. The Discord ID comes from the session, never from the request, so nobody can read another player's page here. */
export const GET = protectedRoute(
  async ({ req, session }) => {
    const force = req.nextUrl.searchParams.get("refresh") === "1";
    kickMatchSync(force);
    return buildProfile({ id: session.discordId, displayName: session.displayName, avatarUrl: session.avatarUrl }, force);
  },
  { allowMember: true },
);
