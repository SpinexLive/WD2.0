import { protectedRoute } from "@/lib/apiGuard";
import { buildToday } from "@/server/services/today";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async ({ session }) => buildToday(session.discordId), { allowMember: true });
