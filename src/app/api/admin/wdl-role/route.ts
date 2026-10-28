import { z } from "zod";
import { protectedRoute } from "@/lib/apiGuard";
import { requireOwner } from "@/lib/admin";
import { getWdlRoleStatus, saveWdlRole, syncWdlRole } from "@/server/services/wdlRole";

export const dynamic = "force-dynamic";
export const GET = protectedRoute(async ({ session }) => {
  requireOwner(session);
  return getWdlRoleStatus();
});
export const PUT = protectedRoute(async ({ req, session }) => {
  requireOwner(session);
  const { roleId } = z.object({ roleId: z.string().regex(/^\d{17,20}$/).nullable() }).strict().parse(await req.json().catch(() => null));
  return saveWdlRole(session, roleId);
});
export const POST = protectedRoute(async ({ session }) => {
  requireOwner(session);
  return syncWdlRole(session);
});
