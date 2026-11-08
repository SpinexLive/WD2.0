import { z } from "zod";
import { protectedRoute } from "@/lib/apiGuard";
import { eventIdSchema } from "@/server/services/rosters";
import { createBriefingChannels } from "@/server/services/briefingChannels";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  eventId: eventIdSchema,
  channels: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    squadIds: z.array(z.string().uuid()).min(1).max(40),
  }).strict()).min(1).max(40),
}).strict();

export const POST = protectedRoute(async ({ req, session }) => {
  const body = bodySchema.parse(await req.json().catch(() => null));
  return createBriefingChannels(body.eventId, body.channels, session);
});
