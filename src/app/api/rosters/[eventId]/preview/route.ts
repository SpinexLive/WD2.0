import { protectedRoute } from "@/lib/apiGuard";
import { getPostableChannels } from "@/server/services/discord";
import { buildPreview, loadForPublish } from "@/server/services/rosterPublish";
import { eventIdSchema } from "@/server/services/rosters";

export const dynamic = "force-dynamic";

export const GET = protectedRoute<{ eventId: string }>(async ({ params }) => {
  const { roster, event } = await loadForPublish(eventIdSchema.parse(params.eventId));
  const preview = await buildPreview(roster, event);
  const channelId = roster.messages[0]?.channelId ?? event.channelId;
  const destination = channelId ? { id: channelId, name: (await getPostableChannels().then((s) => s.data, () => [])).find((c) => c.id === channelId)?.name ?? null } : null;
  return {
    version: roster.version,
    embeds: preview.embeds,
    names: preview.names,
    warnings: preview.warnings,
    messages: roster.messages,
    destination,
  };
});
