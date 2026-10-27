import { protectedRoute } from "@/lib/apiGuard";
import { buildBriefing } from "@/server/services/briefing";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async () => buildBriefing());
