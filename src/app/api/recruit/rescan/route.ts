import { protectedRoute } from "@/lib/apiGuard";
import { kickMatchSync, matchSyncStatus } from "@/server/services/matchHistory";

export const dynamic = "force-dynamic";

/** Starts a forced match-history sync in the background. */
export const POST = protectedRoute(async () => {
  kickMatchSync(true);
  return matchSyncStatus();
});
export const GET = protectedRoute(async () => matchSyncStatus());
