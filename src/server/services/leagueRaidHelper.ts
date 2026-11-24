import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
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

export async function updateLeagueEvent(eventId: string, changes: { title: string; description: string; advancedSettings?: { temp_role: string } }) {
  if (!/^[\w-]{1,64}$/.test(eventId)) throw new HttpError(400, "Invalid Raid Helper event ID.", "invalid_event");
  await requestJson({
    provider: "raid-helper", method: "PATCH", url: raidUrl(`/api/v4/events/${encodeURIComponent(eventId)}`),
    headers: raidHeaders(), body: changes, retries: 0, timeoutMs: 15000,
  });
}

export async function prepareLeagueRoleRename(
  eventId: string, oldName: string, newName: string, scheduled: boolean, expectedTitle = oldName,
): Promise<string | null> {
  const [event, roles, posted, schedules] = await Promise.all([
    scheduled ? getScheduledLeagueEvent(eventId) : getRawLeagueEvent(eventId),
    discordData("roles").then((data) => z.array(discordName.extend({ managed: z.boolean() })).parse(data)),
    getPostedLeagueEvents(), getScheduledLeagueEvents(),
  ]);
  const settings = z.object({ temp_role: z.string() }).safeParse(event.advancedSettings);
  const roleId = z.string().regex(/^\d{15,22}$/).optional().safeParse(event.temporaryRole ?? undefined);
  const oldRoles = roles.filter((role) => role.name.toLowerCase() === oldName.toLowerCase());
  const signups = z.array(z.unknown()).safeParse(event.signUps);
  const noPostedRole = !scheduled && roleId.success && roleId.data === undefined &&
    oldRoles.length === 0 && signups.success && signups.data.length === 0;
  if (event.serverId !== env().DISCORD_GUILD_ID || event.title !== expectedTitle ||
      !settings.success || settings.data.temp_role !== oldName || !roleId.success ||
      roles.some((role) => role.name.toLowerCase() === newName.toLowerCase()) ||
      (scheduled ? oldRoles.length !== 0 || roleId.data !== undefined
        : !noPostedRole && (oldRoles.length !== 1 || oldRoles[0]?.name !== oldName || oldRoles[0]?.id !== roleId.data || oldRoles[0]?.managed))) {
    throw new HttpError(409, "The temporary role or its new name could not be verified.", "gwl_slot_unsafe");
  }
  const others = [...posted, ...schedules].filter((item) => item.id !== eventId);
  for (const other of others) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const data = await (schedules.some((item) => item.id === other.id)
      ? getScheduledLeagueEvent(other.id) : getRawLeagueEvent(other.id));
    const otherSettings = z.object({ temp_role: z.string().nullable().optional() }).safeParse(data.advancedSettings);
    if (!otherSettings.success || otherSettings.data.temp_role?.toLowerCase() === oldName.toLowerCase() ||
        otherSettings.data.temp_role?.toLowerCase() === newName.toLowerCase() ||
        (roleId.data && data.temporaryRole === roleId.data)) {
      throw new HttpError(409, "Another Raid Helper event may use the temporary role.", "gwl_slot_unsafe");
    }
  }
  return roleId.data ?? null;
}

export function otherLeagueSettingsUnchanged(before: unknown, after: unknown): boolean {
  const schema = z.record(z.unknown());
  const previous = schema.safeParse(before);
  const current = schema.safeParse(after);
  if (!previous.success || !current.success) return false;
  const { temp_role: _oldRole, ...oldSettings } = previous.data;
  const { temp_role: _newRole, ...newSettings } = current.data;
  return isDeepStrictEqual(oldSettings, newSettings);
}

export async function updateLeagueTempRole(eventId: string, name: string) {
  if (!/^[\w-]{1,64}$/.test(eventId)) throw new HttpError(400, "Invalid Raid Helper event ID.", "invalid_event");
  await requestJson({
    provider: "raid-helper", method: "PATCH", url: raidUrl(`/api/v4/events/${encodeURIComponent(eventId)}`),
    headers: raidHeaders(), body: { advancedSettings: { temp_role: name } }, retries: 0, timeoutMs: 15000,
  });
}

export async function renameLeagueRole(roleId: string, oldName: string, newName: string) {
  const roles = z.array(discordName.extend({ managed: z.boolean() })).parse(await discordData("roles"));
  if (roles.filter((role) => role.name.toLowerCase() === oldName.toLowerCase()).length !== 1 ||
      !roles.some((role) => role.id === roleId && role.name === oldName && !role.managed) ||
      roles.some((role) => role.name.toLowerCase() === newName.toLowerCase())) {
    throw new Error("The temporary role changed during the update checks.");
  }
  const e = env();
  const { data } = await requestJson({
    provider: "discord", method: "PATCH",
    url: `https://discord.com/api/v10/guilds/${e.DISCORD_GUILD_ID}/roles/${encodeURIComponent(roleId)}`,
    headers: { Authorization: `Bot ${e.DISCORD_BOT_TOKEN}`, "X-Audit-Log-Reason": "Synchronize GWL event role" },
    body: { name: newName }, retries: 0,
  });
  const role = discordName.parse(data);
  if (role.id !== roleId || role.name !== newName) throw new Error("The Discord role rename could not be confirmed.");
}

export async function verifyLeagueRoleRename(roleId: string, oldName: string, newName: string) {
  const roles = z.array(discordName).parse(await discordData("roles"));
  if (roles.some((role) => role.name.toLowerCase() === oldName.toLowerCase()) ||
      roles.filter((role) => role.name.toLowerCase() === newName.toLowerCase()).length !== 1 ||
      !roles.some((role) => role.id === roleId && role.name === newName)) {
    throw new Error("The updated Discord role could not be verified.");
  }
}

export async function verifyLeagueRoleAbsent(oldName: string, newName: string) {
  const roles = z.array(discordName).parse(await discordData("roles"));
  if (roles.some((role) => [oldName.toLowerCase(), newName.toLowerCase()].includes(role.name.toLowerCase()))) {
    throw new Error("An unexpected Discord role appeared during the update.");
  }
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
