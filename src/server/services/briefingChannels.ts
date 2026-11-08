import { env } from "@/lib/env";
import { HttpError, ProviderError, requestJson } from "@/lib/http";
import type { Session } from "@/lib/session";
import { audit } from "@/lib/audit";
import { query } from "@/lib/db";
import { buildBriefingChannelOverwrites, formatBriefingChannelName, nextLondonMidnight } from "@/lib/briefingChannels";
import { getRoster } from "./rosters";

const API = "https://discord.com/api/v10";
export const BRIEFING_CHANNEL_CATEGORY_ID = "1546184713683865702";

export interface BriefingChannelPlan {
  name: string;
  squadIds: string[];
}

export interface CreatedBriefingChannel {
  id: string;
  name: string;
  squadNames: string[];
  deleteAt: string;
}

interface CleanupChannel extends CreatedBriefingChannel {
  guildId: string;
  creatorId: string;
  creatorName: string;
}

const botHeaders = () => ({ Authorization: `Bot ${env().DISCORD_BOT_TOKEN}` });

async function deleteDiscordChannel(channelId: string): Promise<void> {
  await requestJson({
    provider: "discord",
    method: "DELETE",
    url: `${API}/channels/${channelId}`,
    headers: botHeaders(),
    okStatuses: [404],
    retries: 0,
  });
}

function mapCreateError(error: unknown): never {
  if (error instanceof ProviderError && (error.code === "50013" || error.code === "50001" || error.status === 403)) {
    throw new HttpError(403, "The bot needs Manage Channels permission and access to the briefing category.", "bot_permission");
  }
  throw error;
}

export async function createBriefingChannels(eventId: string, plans: BriefingChannelPlan[], actor: Session): Promise<{ guildId: string; channels: CreatedBriefingChannel[] }> {
  const roster = await getRoster(eventId);
  if (!roster) throw new HttpError(404, "This event has no saved roster.", "roster_not_found");

  const squads = new Map(roster.squads.map((squad) => [squad.id, squad.name]));
  const assigned = new Set<string>();
  const names = new Set<string>();
  const normalizedPlans = plans.map((plan) => {
    const name = formatBriefingChannelName(plan.name);
    if (!name) throw new HttpError(400, "Each channel needs a name containing letters or numbers.", "invalid_input");
    if (names.has(name)) throw new HttpError(400, "Channel names must be unique after formatting.", "invalid_input");
    names.add(name);
    for (const squadId of plan.squadIds) {
      if (!squads.has(squadId)) throw new HttpError(400, "A selected squad is not part of this roster.", "invalid_input");
      if (assigned.has(squadId)) throw new HttpError(400, "A squad can only be assigned to one voice channel.", "invalid_input");
      assigned.add(squadId);
    }
    return { name, squadIds: plan.squadIds, squadNames: plan.squadIds.map((id) => squads.get(id)!) };
  });

  const guildId = env().DISCORD_GUILD_ID;
  const [channelsResult, rolesResult, botResult] = await Promise.all([
    requestJson({ provider: "discord", url: `${API}/guilds/${guildId}/channels`, headers: botHeaders() }),
    requestJson({ provider: "discord", url: `${API}/guilds/${guildId}/roles`, headers: botHeaders() }),
    requestJson({ provider: "discord", url: `${API}/users/@me`, headers: botHeaders() }),
  ]);
  const channels = channelsResult.data as { id: string; type: number }[];
  if (!channels.some((channel) => channel.id === BRIEFING_CHANNEL_CATEGORY_ID && channel.type === 4)) {
    throw new HttpError(400, "The configured briefing channel category was not found in this server.", "category_not_found");
  }

  const roleId = env().DISCORD_CLAN_ROLE_ID;
  const roles = rolesResult.data as { id: string; permissions: string }[];
  if (!roles.some((role) => role.id === roleId)) throw new HttpError(400, "The configured clan visibility role was not found in this server.", "role_not_found");
  const botId = (botResult.data as { id?: string }).id;
  if (!botId) throw new ProviderError("discord", "Discord did not identify the dashboard bot");

  const overwrites = buildBriefingChannelOverwrites(guildId, roleId, botId, roles);
  if (overwrites.length > 100) throw new HttpError(400, "This server has too many roles with channel visibility permissions to create a private channel.", "too_many_role_overwrites");

  const created: CreatedBriefingChannel[] = [];
  for (const plan of normalizedPlans) {
    try {
      const { data } = await requestJson({
        provider: "discord",
        method: "POST",
        url: `${API}/guilds/${guildId}/channels`,
        headers: botHeaders(),
        retries: 0,
        body: { name: plan.name, type: 2, parent_id: BRIEFING_CHANNEL_CATEGORY_ID, permission_overwrites: overwrites },
      });
      const id = (data as { id?: string }).id;
      if (!id) throw new ProviderError("discord", "Discord created a voice channel without returning its ID", undefined, false);
      const deleteAt = nextLondonMidnight(Date.now());
      const channel: CreatedBriefingChannel = { id, name: plan.name, squadNames: plan.squadNames, deleteAt: deleteAt.toISOString() };
      try {
        await query(
          `INSERT INTO briefing_voice_channels
             (channel_id, guild_id, event_id, channel_name, squad_names, creator_id, creator_name, delete_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, guildId, eventId, plan.name, plan.squadNames, actor.discordId, actor.displayName, deleteAt],
        );
      } catch (error) {
        try {
          await deleteDiscordChannel(id);
        } catch (cleanupError) {
          const reason = cleanupError instanceof Error ? cleanupError.message : "Unknown Discord error";
          throw new HttpError(500, `Created "${plan.name}", but could not schedule its automatic deletion or remove it. Manually delete channel ${id}. ${reason}`, "channel_cleanup_not_scheduled", {
            created: [...created, { ...channel, cleanupRequired: true }],
            guildId,
          });
        }
        throw new HttpError(500, `Could not schedule automatic deletion for "${plan.name}". The channel was removed.`, "channel_cleanup_not_scheduled");
      }
      created.push(channel);
    } catch (error) {
      if (created.length) {
        await audit(actor, "briefing.channels_partial", "event", eventId, { created, failedChannel: plan.name });
        const message = error instanceof Error ? error.message : "Unknown Discord error";
        if (error instanceof HttpError && error.code === "channel_cleanup_not_scheduled") {
          throw new HttpError(error.status, `${message} ${created.length} earlier channel${created.length === 1 ? " remains" : "s remain"} scheduled for deletion.`, error.code, {
            ...error.extra,
            created: [...created, ...((error.extra?.created as CreatedBriefingChannel[] | undefined) ?? [])],
            guildId,
          });
        }
        throw new HttpError(502, `Created ${created.length} channel${created.length === 1 ? "" : "s"}, but could not create "${plan.name}". The channels already created remain scheduled for deletion. ${message}`, "partial_channel_creation", { created, guildId });
      }
      mapCreateError(error);
    }
  }

  await audit(actor, "briefing.channels_created", "event", eventId, { channels: created });
  return { guildId, channels: created };
}
