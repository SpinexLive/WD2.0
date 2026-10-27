import { z } from "zod";
import { protectedRoute } from "@/lib/apiGuard";
import { audit } from "@/lib/audit";
import { closeEvent, manageEvents, openEvent } from "@/server/services/scouting";
import { closeFeedbackPrompt, postFeedbackPrompt } from "@/server/services/scoutingDiscord";

export const dynamic = "force-dynamic";

/** Staff: recent Raid Helper events and whether they're open for scouting feedback. */
export const GET = protectedRoute(async () => ({ events: await manageEvents() }));

const faction = z.enum(["lonestar", "manticore", "valkyra"]).nullable().optional().transform((v) => v ?? null);

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), eventId: z.string().min(1).max(40), teamA: z.string().max(80), teamB: z.string().max(80), factionA: faction, factionB: faction }),
  z.object({ action: z.literal("close"), eventId: z.string().min(1).max(40) }),
  z.object({ action: z.literal("post"), eventId: z.string().min(1).max(40) }),
]);

export const POST = protectedRoute(async ({ req, session }) => {
  const i = body.parse(await req.json().catch(() => null));
  if (i.action === "open") {
    await openEvent(i.eventId, i.teamA, i.teamB, session.discordId, i.factionA, i.factionB);
    await audit(session, "scouting.open", "event", i.eventId, { teamA: i.teamA, teamB: i.teamB, factionA: i.factionA, factionB: i.factionB });
  } else if (i.action === "post") {
    const r = await postFeedbackPrompt(i.eventId);
    await audit(session, "scouting.post_prompt", "event", i.eventId, { channelId: r.channelId });
  } else {
    await closeEvent(i.eventId);
    await closeFeedbackPrompt(i.eventId);
    await audit(session, "scouting.close", "event", i.eventId, {});
  }
  return { ok: true };
});
