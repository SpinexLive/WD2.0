import { protectedRoute } from "@/lib/apiGuard";
import { requireOwner } from "@/lib/admin";
import { serverNameSettingsSchema } from "@/lib/serverName";
import { serverNameStatus, saveServerNameSettings } from "@/server/services/serverName";

export const dynamic = "force-dynamic";
export const GET = protectedRoute(async ({ session }) => { requireOwner(session); return serverNameStatus(); });
export const PUT = protectedRoute(async ({ session, req }) => {
  requireOwner(session);
  return saveServerNameSettings(serverNameSettingsSchema.parse(await req.json()), session);
});
