import { protectedRoute } from "@/lib/apiGuard";
import { remindPending } from "@/server/services/rosterPublish";
import { eventIdSchema } from "@/server/services/rosters";

export const dynamic = "force-dynamic";

export const POST = protectedRoute<{ eventId: string }>(async ({ session, params }) => {
  return remindPending(eventIdSchema.parse(params.eventId), session);
});
