import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { requestJson } from "@/lib/http";
import { audit } from "@/lib/audit";

const API = "https://discord.com/api/v10";

const botHeaders = () => ({ Authorization: `Bot ${env().DISCORD_BOT_TOKEN}` });

async function deleteChannel(channelId: string): Promise<void> {
  await requestJson({
    provider: "discord",
    method: "DELETE",
    url: `${API}/channels/${channelId}`,
    headers: botHeaders(),
    okStatuses: [404],
    retries: 0,
  });
}

export async function syncBriefingChannelCleanup(now = Date.now()): Promise<void> {
  const due = await query<{
    channel_id: string;
    event_id: string;
    channel_name: string;
    squad_names: string[];
    creator_id: string;
    creator_name: string;
  }>(
    `WITH due AS (
       SELECT channel_id
       FROM briefing_voice_channels
       WHERE delete_at <= to_timestamp($1 / 1000.0)
         AND (
           (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= now()))
           OR (status = 'deleting' AND lease_until < now())
         )
       ORDER BY delete_at
       LIMIT 25
       FOR UPDATE SKIP LOCKED
     )
     UPDATE briefing_voice_channels AS channels
     SET status = 'deleting', lease_until = now() + interval '2 minutes'
     FROM due
     WHERE channels.channel_id = due.channel_id
     RETURNING channels.channel_id, channels.event_id, channels.channel_name,
               channels.squad_names, channels.creator_id, channels.creator_name`,
    [now],
  );

  for (const channel of due) {
    try {
      await deleteChannel(channel.channel_id);
      await query(
        `UPDATE briefing_voice_channels
         SET status = 'deleted', deleted_at = now(), lease_until = NULL,
             next_attempt_at = NULL, last_error = NULL
         WHERE channel_id = $1 AND status = 'deleting'`,
        [channel.channel_id],
      );
      await audit(
        { discordId: channel.creator_id, displayName: channel.creator_name },
        "briefing.channel_auto_deleted",
        "event",
        channel.event_id,
        { channelId: channel.channel_id, channelName: channel.channel_name, squadNames: channel.squad_names },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Discord channel cleanup error";
      await query(
        `UPDATE briefing_voice_channels
         SET status = 'pending', lease_until = NULL,
             next_attempt_at = now() + interval '5 minutes',
             attempts = attempts + 1, last_error = $2
         WHERE channel_id = $1 AND status = 'deleting'`,
        [channel.channel_id, message.slice(0, 500)],
      );
      console.error(`Briefing channel cleanup failed for ${channel.channel_id}:`, message);
    }
  }
}

const g = globalThis as unknown as { __briefingChannelCleanupTimer?: NodeJS.Timeout; __briefingChannelCleanupRunning?: boolean };

export function startBriefingChannelCleanupScheduler(): void {
  if (process.env.NEXT_PHASE === "phase-production-build" || g.__briefingChannelCleanupTimer) return;
  const run = () => {
    if (g.__briefingChannelCleanupRunning) return;
    g.__briefingChannelCleanupRunning = true;
    void syncBriefingChannelCleanup()
      .catch((error: Error) => console.error("Briefing channel cleanup scheduler:", error.message))
      .finally(() => { g.__briefingChannelCleanupRunning = false; });
  };
  run();
  g.__briefingChannelCleanupTimer = setInterval(run, 30_000);
  g.__briefingChannelCleanupTimer.unref();
}
