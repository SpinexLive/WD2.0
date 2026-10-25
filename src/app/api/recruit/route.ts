import { protectedRoute } from "@/lib/apiGuard";
import { buildRecruitReport } from "@/server/services/recruit";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async () => buildRecruitReport());
