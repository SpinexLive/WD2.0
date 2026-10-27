import { protectedRoute } from "@/lib/apiGuard";
import { teamDetail } from "@/server/services/scouting";

export const dynamic = "force-dynamic";

export const GET = protectedRoute<{ key: string }>(async ({ params }) => teamDetail(params.key.slice(0, 80)), { reviewerOnly: true });
