import { protectedRoute } from "@/lib/apiGuard";
import { getPostableChannels } from "@/server/services/discord";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async ({ req }) => {
  const snap = await getPostableChannels(req.nextUrl.searchParams.get("refresh") === "1");
  return { channels: snap.data, source: { fetchedAt: snap.fetchedAt, stale: snap.stale, error: snap.error ?? null } };
});
