import { z } from "zod";
import { protectedRoute } from "@/lib/apiGuard";
import { HttpError } from "@/lib/http";
import { respondToRoster } from "@/server/services/rosterResponses";

export const dynamic = "force-dynamic";

const body = z.object({ eventId: z.string().min(1).max(40), response: z.enum(["accepted", "declined"]) });

/** Confirm or decline your own spot on a roster, same as the Discord buttons. */
export const POST = protectedRoute(
  async ({ req, session }) => {
    const input = body.parse(await req.json().catch(() => null));
    const ok = await respondToRoster(input.eventId, session.discordId, session.displayName, input.response);
    if (!ok) throw new HttpError(403, "You are not assigned a spot in this roster.", "not_assigned");
    return { ok: true };
  },
  { allowMember: true },
);
