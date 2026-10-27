import { z } from "zod";
import { protectedRoute } from "@/lib/apiGuard";
import { memberEvents, saveObservation } from "@/server/services/scouting";

export const dynamic = "force-dynamic";

/** Open matches the signed-in member was rostered for, with their own notes. */
export const GET = protectedRoute(async ({ session }) => ({ events: await memberEvents(session.discordId, session.isAdmin) }), { allowMember: true });

const body = z.object({ eventId: z.string().min(1).max(40), slot: z.enum(["a", "b"]), body: z.string().max(2000) });

export const POST = protectedRoute(
  async ({ req, session }) => {
    const i = body.parse(await req.json().catch(() => null));
    await saveObservation(i.eventId, i.slot, session.discordId, i.body, session.isAdmin);
    return { ok: true };
  },
  { allowMember: true },
);
