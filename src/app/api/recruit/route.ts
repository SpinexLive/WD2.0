import { protectedRoute } from "@/lib/apiGuard";
import { buildRecruitReport } from "@/server/services/recruit";
import { recruitAlertStatus } from "@/server/services/recruitAlerts";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async () => {
  const [report, alerts] = await Promise.all([buildRecruitReport(), recruitAlertStatus()]);
  return { ...report, alerts };
});
