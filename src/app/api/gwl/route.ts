import { protectedRoute } from "@/lib/apiGuard";
import { getGwlApplications, getGwlElo, getGwlFixtures, getGwlMembers, getGwlSlots, getGwlTeam } from "@/server/services/gwl";
import { archiveGwlFixtures, getArchivedGwlResults } from "@/server/services/gwlFixtures";
import { gwlRaidStatus } from "@/server/services/gwlRaid";

export const dynamic = "force-dynamic";
export const GET = protectedRoute(async ({ req }) => {
  const force = req.nextUrl.searchParams.get("refresh") === "1";
  const [team, members, applications, fixtures, elo, slots] = await Promise.all([
    getGwlTeam(force), getGwlMembers(force), getGwlApplications(force), getGwlFixtures(force), getGwlElo(force), getGwlSlots(force),
  ]);
  if (!fixtures.stale) await archiveGwlFixtures(fixtures.data);
  const [archivedResults, raid] = await Promise.all([getArchivedGwlResults(), gwlRaidStatus()]);
  return { team, members, applications, fixtures, elo, slots, archivedResults, raid };
});
