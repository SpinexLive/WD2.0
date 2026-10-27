import { protectedRoute } from "@/lib/apiGuard";
import { requireOwner } from "@/lib/admin";
import { env } from "@/lib/env";
import { getHealth } from "@/server/services/monitor";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async ({ req, session }) => {
  requireOwner(session);
  const components = await getHealth(req.nextUrl.searchParams.get("refresh") === "1");
  return { components, alertsEnabled: Boolean(env().ALERT_CHANNEL_ID), checkedAt: new Date().toISOString() };
});
