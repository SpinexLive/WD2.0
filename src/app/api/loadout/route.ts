import { protectedRoute } from "@/lib/apiGuard";
import { isOwner } from "@/lib/admin";
import { loadoutTable } from "@/server/services/loadout";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async ({ session }) => ({
  ...await loadoutTable(),
  canSendReminder: isOwner(session) && !session.viewingAs,
}));
