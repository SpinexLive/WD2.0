import { protectedRoute } from "@/lib/apiGuard";
import { audit } from "@/lib/audit";
import { assertChannel, postLoadoutEmbed } from "@/server/services/loadout";

export const dynamic = "force-dynamic";

/** Staff: posts (or reposts) the loadout tracker embed in the chosen channel. */
export const POST = protectedRoute(async ({ req, session }) => {
  const b = (await req.json().catch(() => null)) as { channelId?: unknown } | null;
  const channelId = assertChannel(b?.channelId);
  await postLoadoutEmbed(channelId, session.discordId);
  await audit(session, "loadout.post", "channel", channelId, {});
  return { ok: true };
});
