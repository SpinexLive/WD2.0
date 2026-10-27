import { Client, GatewayIntentBits, MessageFlags, type ButtonInteraction as DjsButton, type Guild } from "discord.js";
import { env } from "@/lib/env";
import { setVoice } from "./voice";
import { BUTTON_PREFIX } from "./rosterPublish";
import { handleRosterButton } from "./rosterResponses";

const g = globalThis as unknown as { __rosterGateway?: Client };

export const gatewayReady = () => g.__rosterGateway?.isReady() ?? false;

async function onButton(i: DjsButton) {
  if (!i.customId.startsWith(`${BUTTON_PREFIX}:`)) return;
  try {
    // Acknowledge straight away; Discord only waits 3 seconds, the work below can take longer.
    await i.deferUpdate();
    const res = (await handleRosterButton({ user: { id: i.user.id }, message: { id: i.message.id }, data: { custom_id: i.customId } })) as {
      type: number;
      data: { content?: string; embeds?: never[]; components?: never[] };
    };
    if (res.type === 7) {
      await i.editReply({ content: res.data.content || null, embeds: res.data.embeds, components: res.data.components, allowedMentions: { parse: [] } });
    } else {
      await i.followUp({ content: res.data.content ?? "Done.", flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }
  } catch (err) {
    console.error("roster button failed:", err instanceof Error ? err.message : "unknown");
    await i.followUp({ content: "Something went wrong. Please try again.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}

/**
 * Listens for Confirm/Decline clicks over the Discord gateway, so no public URL or Interactions Endpoint is needed
 * and the existing bot keeps handling its own buttons. Only buttons created by this dashboard are handled.
 */
export function startRosterGateway(): void {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (g.__rosterGateway) return;
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  g.__rosterGateway = client;
  const refreshVoice = (guild: Guild) => {
    if (guild.id !== env().DISCORD_GUILD_ID) return;
    const byChannel = new Map<string, string[]>();
    for (const vs of guild.voiceStates.cache.values()) {
      if (!vs.channelId || vs.member?.user.bot) continue;
      byChannel.set(vs.channelId, [...(byChannel.get(vs.channelId) ?? []), vs.id]);
    }
    setVoice([...byChannel].map(([id, userIds]) => ({ id, name: guild.channels.cache.get(id)?.name ?? "Voice", userIds })));
  };
  client.on("clientReady", () => client.guilds.cache.forEach(refreshVoice));
  client.on("guildCreate", refreshVoice);
  client.on("voiceStateUpdate", (_old, next) => refreshVoice(next.guild));
  client.on("interactionCreate", (i) => {
    if (i.isButton()) void onButton(i);
  });
  client.on("error", (e) => console.error("roster gateway error:", e.message));
  client.login(env().DISCORD_BOT_TOKEN).then(
    () => console.log("roster gateway connected"),
    (e: Error) => {
      console.error("roster gateway login failed:", e.message);
      g.__rosterGateway = undefined;
    },
  );
}
