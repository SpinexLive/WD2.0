import { protectedRoute } from "@/lib/apiGuard";
import { listTeams } from "@/server/services/scouting";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async () => ({ teams: await listTeams() }), { reviewerOnly: true });
