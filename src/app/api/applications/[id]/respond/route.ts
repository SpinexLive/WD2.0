import { z } from "zod";
import { protectedRoute } from "@/lib/apiGuard";
import { HttpError } from "@/lib/http";
import { audit } from "@/lib/audit";
import { singleFlight } from "@/lib/ratelimit";
import { getLeagueApplications, getLeagueMembers, respondToApplication } from "@/server/services/wardogsLeague";

export const dynamic = "force-dynamic";

const body = z.object({ accept: z.boolean() }).strict();
const idSchema = z.string().regex(/^[\w-]{1,64}$/);

export const POST = protectedRoute<{ id: string }>(async ({ req, session, params }) => {
  const id = idSchema.parse(params.id);
  const { accept } = body.parse(await req.json().catch(() => null));

  const result = await singleFlight(`app:${id}`, async () => {
    const current = await getLeagueApplications(true);
    if (current.stale || !current.data.some((a) => a.id === id)) {
      throw new HttpError(409, "This application is no longer pending or could not be confirmed. Refresh and try again.", "not_pending");
    }
    try {
      await respondToApplication(id, accept);
    } catch (err) {
      await audit(session, accept ? "application.accept_failed" : "application.reject_failed", "application", id, { error: (err as Error).message });
      throw err;
    }
    await audit(session, accept ? "application.accept" : "application.reject", "application", id);

    // The action succeeded upstream; a failed refresh must not hide that.
    const refreshed = await Promise.allSettled([getLeagueMembers(true), getLeagueApplications(true)]);
    return { refreshed: refreshed.every((r) => r.status === "fulfilled") };
  });

  if (result === "busy") throw new HttpError(409, "A response for this application is already in progress", "duplicate");
  return { ok: true, outcome: accept ? "accepted" : "rejected", refreshed: result.refreshed };
});
