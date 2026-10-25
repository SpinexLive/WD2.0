import { z } from "zod";
import { protectedRoute } from "@/lib/apiGuard";
import { audit } from "@/lib/audit";
import { eventIdSchema, resetRoster } from "@/server/services/rosters";

export const dynamic = "force-dynamic";

export const POST = protectedRoute<{ eventId: string }>(async ({ req, session, params }) => {
  const eventId = eventIdSchema.parse(params.eventId);
  const { version } = z.object({ version: z.number().int().min(1) }).strict().parse(await req.json().catch(() => null));
  const roster = await resetRoster(eventId, version, session.discordId);
  await audit(session, "roster.reset", "roster", roster.id, { eventId });
  return { roster };
});
