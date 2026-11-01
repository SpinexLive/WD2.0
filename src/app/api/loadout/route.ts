import { protectedRoute } from "@/lib/apiGuard";
import { loadoutTable } from "@/server/services/loadout";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async () => loadoutTable());
