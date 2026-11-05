import { protectedRoute } from "@/lib/apiGuard";
import { fixtureOverview } from "@/server/services/wdlFixtures";

export const dynamic = "force-dynamic";
export const GET = protectedRoute(async ({ req }) => fixtureOverview(req.nextUrl.searchParams.get("refresh") === "1"));
