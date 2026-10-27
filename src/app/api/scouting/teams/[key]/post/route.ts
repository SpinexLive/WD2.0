import { protectedRoute } from "@/lib/apiGuard";
import { audit } from "@/lib/audit";
import { postOverview } from "@/server/services/scoutingDiscord";

export const dynamic = "force-dynamic";

/** Staff only: posts the saved AI overview for a team to the scouting channel as an embed. */
export const POST = protectedRoute<{ key: string }>(async ({ params, session }) => {
  const key = params.key.slice(0, 80);
  const r = await postOverview(key);
  await audit(session, "scouting.post_overview", "team", key, { channelId: r.channelId });
  return { ok: true };
});
