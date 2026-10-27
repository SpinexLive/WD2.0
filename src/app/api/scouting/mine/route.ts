import { z } from "zod";
import { protectedRoute } from "@/lib/apiGuard";
import { memberEvents, saveObservation } from "@/server/services/scouting";

export const dynamic = "force-dynamic";

/** Open matches the signed-in member was rostered for, with their own notes. */
export const GET = protectedRoute(async ({ session }) => ({ events: await memberEvents(session.discordId, (session.isAdmin || session.isReviewer)) }), { allowMember: true });

const text = z.string().max(2000).default("");
const body = z.object({ eventId: z.string().min(1).max(40), slot: z.enum(["a", "b"]), overview: text, strengths: text, weaknesses: text, tactics: text });

export const POST = protectedRoute(
  async ({ req, session }) => {
    const i = body.parse(await req.json().catch(() => null));
    await saveObservation(i.eventId, i.slot, session.discordId, i, (session.isAdmin || session.isReviewer));
    return { ok: true };
  },
  { allowMember: true },
);
