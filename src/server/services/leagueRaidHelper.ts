import { z } from "zod";
import { env } from "@/lib/env";
import { HttpError, requestJson } from "@/lib/http";
import type { gwlEventBody } from "./gwlRaidHelper";

export const LEAGUE_EVENT_CHANNEL = "1546479425644793877";
export const LEAGUE_MEMBER_ROLE = "1546184733174669424";
export const LEAGUE_VOICE_CHANNEL = "1546197103498363031";

const discordName = z.object({ id: z.string(), name: z.string().min(1) });
const discordChannel = discordName.extend({ type: z.number() });

async function discordData(path: string) {
  const e = env();
  return (await requestJson({ provider: "discord", url: `https://discord.com/api/v10/guilds/${e.DISCORD_GUILD_ID}/${path}`,
    headers: { Authorization: `Bot ${e.DISCORD_BOT_TOKEN}` }, retries: 0 })).data;
}

export async function leagueEventNames() {
  if (env().DISCORD_GUILD_ID !== "1332320879073296404") {
    throw new HttpError(503, "The configured Discord guild does not match the league event server.", "league_wrong_guild");
  }
  const [roles, channels] = await Promise.all([
    discordData("roles").then((data) => z.array(discordName).parse(data)),
    discordData("channels").then((data) => z.array(discordChannel).parse(data)),
  ]);
  const role = roles.find((item) => item.id === LEAGUE_MEMBER_ROLE);
  const voice = channels.find((item) => item.id === LEAGUE_VOICE_CHANNEL && (item.type === 2 || item.type === 13));
  if (!role || !voice) throw new HttpError(503, "Could not resolve the configured member role and briefing voice channel.", "league_role_unavailable");
  if (roles.filter((item) => item.name.toLowerCase() === role.name.toLowerCase()).length !== 1 ||
      channels.filter((item) => (item.type === 2 || item.type === 13) && item.name.toLowerCase() === voice.name.toLowerCase()).length !== 1 ||
      /,/.test(role.name) || /^(all|none)$/i.test(role.name)) {
    throw new HttpError(409, "The member role or briefing channel name is ambiguous for Raid Helper.", "league_name_ambiguous");
  }
  return { role: role.name, voice: voice.name, roleNames: roles.map((item) => item.name.toLowerCase()) };
}

function raidUrl(path: string): string {
  return `${env().RAID_HELPER_BASE_URL.replace(/\/+$/, "")}${path}`;
}
const raidHeaders = () => ({ Authorization: env().RAID_HELPER_API_TOKEN });

async function createRaidEvent(channelId: string, body: ReturnType<typeof gwlEventBody>) {
  if (channelId !== LEAGUE_EVENT_CHANNEL) throw new HttpError(400, "Invalid Raid Helper event channel.", "invalid_channel");
  const { data } = await requestJson({
    provider: "raid-helper", method: "POST",
    url: raidUrl(`/api/v4/servers/${env().DISCORD_GUILD_ID}/channels/${channelId}/event`),
    headers: raidHeaders(), body, retries: 0, timeoutMs: 15000,
  });
  const parsed = z.object({ status: z.string(), event: z.object({ id: z.string().min(1) }) }).safeParse(data);
  if (!parsed.success) throw new Error("Raid Helper returned an unrecognised event-creation response; check Discord before retrying.");
  return parsed.data;
}

export async function createGwlRaidEvent(channelId: string, body: ReturnType<typeof gwlEventBody>) {
  return createRaidEvent(channelId, body);
}

export async function isLeagueEventChannel(channelId: string): Promise<boolean> {
  if (channelId === LEAGUE_EVENT_CHANNEL) return true;
  if (!/^\d{15,22}$/.test(channelId)) throw new HttpError(400, "Invalid Raid Helper event channel.", "invalid_channel");
  const { data } = await requestJson({
    provider: "discord", url: `https://discord.com/api/v10/channels/${channelId}`,
    headers: { Authorization: `Bot ${env().DISCORD_BOT_TOKEN}` }, retries: 0,
  });
  const channel = z.object({ id: z.string(), guild_id: z.string(), parent_id: z.string().nullable(), type: z.number() }).parse(data);
  return channel.id === channelId && channel.guild_id === env().DISCORD_GUILD_ID &&
    channel.parent_id === LEAGUE_EVENT_CHANNEL && [10, 11, 12].includes(channel.type);
}

export async function getScheduledLeagueEvents() {
  const { data } = await requestJson({ provider: "raid-helper", url: raidUrl(`/api/v4/servers/${env().DISCORD_GUILD_ID}/scheduledevents`), headers: raidHeaders() });
  const schema = z.object({ scheduledEvents: z.array(z.object({
    id: z.string(), channelId: z.string(), title: z.string(), startTime: z.number(), postTime: z.number(),
  })) });
  return schema.parse(data).scheduledEvents;
}

export async function getPostedLeagueEvents() {
  const schema = z.object({
    pages: z.number().int().nonnegative(),
    postedEvents: z.array(z.object({ id: z.string(), channelId: z.string(),
      title: z.string(), startTime: z.number(), scheduledId: z.string().nullable().optional() })),
  });
  const events: z.infer<typeof schema>["postedEvents"] = [];
  let pages = 1;
  for (let page = 1; page <= pages; page++) {
    if (page > 100) throw new Error("Raid Helper has too many event pages to check safely.");
    const { data } = await requestJson({
      provider: "raid-helper", url: raidUrl(`/api/v4/servers/${env().DISCORD_GUILD_ID}/events`),
      headers: { ...raidHeaders(), Page: String(page) },
    });
    const result = schema.parse(data);
    pages = result.pages;
    events.push(...result.postedEvents);
  }
  return events;
}

export async function getRawLeagueEvent(eventId: string) {
  if (!/^[\w-]{1,64}$/.test(eventId)) throw new HttpError(400, "Invalid Raid Helper event ID.", "invalid_event");
  const { data } = await requestJson({ provider: "raid-helper", url: raidUrl(`/api/v4/events/${encodeURIComponent(eventId)}`), headers: raidHeaders() });
  return z.object({
    id: z.string(), serverId: z.string(), channelId: z.string(), title: z.string(),
    templateId: z.string(), startTime: z.number(), scheduledId: z.string().nullable().optional(),
  }).passthrough().parse(data);
}

export async function getScheduledLeagueEvent(eventId: string) {
  if (!/^[\w-]{1,64}$/.test(eventId)) throw new HttpError(400, "Invalid Raid Helper event ID.", "invalid_event");
  const { data } = await requestJson({ provider: "raid-helper", url: raidUrl(`/api/v4/events/${encodeURIComponent(eventId)}`), headers: raidHeaders() });
  return z.object({
    serverId: z.string(), channelId: z.string(), title: z.string(), templateId: z.string(),
    startTime: z.number(), postTime: z.number(), interval: z.string(), description: z.string(),
  }).passthrough().parse(data);
}

export async function updateLeagueEvent(eventId: string, changes: { title: string; description: string }) {
  if (!/^[\w-]{1,64}$/.test(eventId)) throw new HttpError(400, "Invalid Raid Helper event ID.", "invalid_event");
  await requestJson({
    provider: "raid-helper", method: "PATCH", url: raidUrl(`/api/v4/events/${encodeURIComponent(eventId)}`),
    headers: raidHeaders(), body: changes, retries: 0, timeoutMs: 15000,
  });
}

export async function updateLeagueEventDescription(eventId: string, description: string) {
  if (!/^[\w-]{1,64}$/.test(eventId)) throw new HttpError(400, "Invalid Raid Helper event ID.", "invalid_event");
  const { data } = await requestJson({
    provider: "raid-helper", method: "PATCH", url: raidUrl(`/api/v4/events/${encodeURIComponent(eventId)}`),
    headers: raidHeaders(), body: { description }, retries: 0, timeoutMs: 15000,
  });
  const result = z.object({ status: z.string(), event: z.object({ id: z.string() }) }).safeParse(data);
  if (!result.success || !["success", "ok", "event updated!"].includes(result.data.status.toLowerCase()) || result.data.event.id !== eventId) {
    throw new Error("Raid Helper did not confirm the event update.");
  }
}

export async function deleteLeagueRaidEvent(eventId: string) {
  if (!/^[\w-]{1,64}$/.test(eventId)) throw new HttpError(400, "Invalid Raid Helper event ID.", "invalid_event");
  const { data } = await requestJson({ provider: "raid-helper", method: "DELETE", url: raidUrl(`/api/v4/events/${encodeURIComponent(eventId)}`),
    headers: raidHeaders(), retries: 0 });
  const result = z.object({ status: z.string() }).safeParse(data);
  if (!result.success || !["success", "ok", "event deleted"].includes(result.data.status.toLowerCase())) {
    throw new Error("Raid Helper did not confirm event deletion.");
  }
}
