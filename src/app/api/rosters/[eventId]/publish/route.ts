import { protectedRoute } from "@/lib/apiGuard";
import { publishRoster, publishSchema } from "@/server/services/rosterPublish";
import { eventIdSchema } from "@/server/services/rosters";

export const dynamic = "force-dynamic";

export const POST = protectedRoute<{ eventId: string }>(async ({ req, session, params }) => {
  const input = publishSchema.parse(await req.json().catch(() => null));
  return publishRoster(eventIdSchema.parse(params.eventId), input, session);
});
