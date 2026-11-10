import { z } from "zod";
import { audit } from "@/lib/audit";
import { protectedRoute } from "@/lib/apiGuard";
import { HttpError } from "@/lib/http";
import { singleFlight } from "@/lib/ratelimit";
import { getGwlApplications, getGwlMembers, respondGwlApplication } from "@/server/services/gwl";

export const dynamic = "force-dynamic";

export const POST = protectedRoute<{ id: string }>(async ({ req, session, params }) => {
  const id = z.string().min(1).max(128).parse(params.id);
  const { accept } = z.object({ accept: z.boolean() }).strict().parse(await req.json().catch(() => null));
  const result = await singleFlight(`gwl:application:${id}`, async () => {
    const pending = await getGwlApplications(true);
    if (pending.stale || !pending.data.applications.some((app) => app.id === id)) {
      throw new HttpError(409, "This GWL application is no longer pending or could not be verified.", "not_pending");
    }
    try {
      await respondGwlApplication(id, accept);
    } catch (error) {
      await audit(session, "gwl.application_response_failed", "gwl_application", id, { accept, error: error instanceof Error ? error.message : "Unknown error" });
      throw error;
    }
    await audit(session, accept ? "gwl.application_accept" : "gwl.application_reject", "gwl_application", id);
    const refreshed = await Promise.allSettled([getGwlApplications(true), getGwlMembers(true)]);
    return { refreshed: refreshed.every((item) => item.status === "fulfilled" && !item.value.stale) };
  });
  if (result === "busy") throw new HttpError(409, "A response for this application is already in progress.", "duplicate");
  return { ok: true, outcome: accept ? "accepted" : "rejected", refreshed: result.refreshed };
});
