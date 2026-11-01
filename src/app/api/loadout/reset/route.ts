import { protectedRoute } from "@/lib/apiGuard";
import { audit } from "@/lib/audit";
import { resetUnlocks } from "@/server/services/loadout";

export const dynamic = "force-dynamic";

/** Staff: removes every member's confirmed unlocks. */
export const POST = protectedRoute(async ({ session }) => {
  const removed = await resetUnlocks();
  await audit(session, "loadout.reset", "loadout", "all", { removed });
  return { ok: true, removed };
});
