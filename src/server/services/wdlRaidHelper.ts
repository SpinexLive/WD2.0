import { z } from "zod";
import { env } from "@/lib/env";
import { HttpError, requestJson } from "@/lib/http";
import { fixtureOpponents, type WdlFixture } from "@/lib/wdlFixtures";

export const WDL_EVENT_CHANNEL = "1546479425644793877";
export const WDL_TEST_CHANNEL = "1546184970706616412";
export const WDL_MEMBER_ROLE = "1546184733174669424";
export const WDL_VOICE_CHANNEL = "1546197103498363031";
const WDL_LEADER = "839225558806167582";
const WDL_COLEADER = "343806666699046933";
const EVENT_IMAGE = "https://images-ext-1.discordapp.net/external/iTjbJ4pJALtmQYMbeIp-YOlm4lD13u40qixjmWUPGgA/https/raid-helper.dev/uploads/1332320879073296404/c9fc5651aef39f3a6f99b17af7dfeca5.png?format=webp&quality=lossless&width=1536&height=864";
const TEN_DAYS = 10 * 24 * 60 * 60;

const discordName = z.object({ id: z.string(), name: z.string().min(1) });
const discordChannel = discordName.extend({ type: z.number() });

async function discordData(path: string) {
  const e = env();
  return (await requestJson({ provider: "discord", url: `https://discord.com/api/v10/guilds/${e.DISCORD_GUILD_ID}/${path}`,
    headers: { Authorization: `Bot ${e.DISCORD_BOT_TOKEN}` }, retries: 0 })).data;
}

export async function wdlEventNames() {
  if (env().DISCORD_GUILD_ID !== "1332320879073296404") {
    throw new HttpError(503, "The configured Discord guild does not match the WDL event server.", "wdl_wrong_guild");
  }
  const [roles, channels] = await Promise.all([
    discordData("roles").then((data) => z.array(discordName).parse(data)),
    discordData("channels").then((data) => z.array(discordChannel).parse(data)),
  ]);
  const role = roles.find((item) => item.id === WDL_MEMBER_ROLE);
  const voice = channels.find((item) => item.id === WDL_VOICE_CHANNEL && (item.type === 2 || item.type === 13));
  if (!role || !voice) throw new HttpError(503, "Could not resolve the configured member role and briefing voice channel.", "wdl_role_unavailable");
  if (roles.filter((item) => item.name.toLowerCase() === role.name.toLowerCase()).length !== 1 ||
      channels.filter((item) => (item.type === 2 || item.type === 13) && item.name.toLowerCase() === voice.name.toLowerCase()).length !== 1 ||
      /,/.test(role.name) || /^(all|none)$/i.test(role.name)) {
    throw new HttpError(409, "The member role or briefing channel name is ambiguous for Raid Helper.", "wdl_name_ambiguous");
  }
  return { role: role.name, voice: voice.name, roleNames: roles.map((item) => item.name.toLowerCase()) };
}

const clean = (value: string | null | undefined) => value?.replace(/@/g, "@\u200b").replace(/[\r\n]/g, " ").trim() || "TBD";

export function wdlEventBody(
  fixture: WdlFixture,
  names: Awaited<ReturnType<typeof wdlEventNames>>,
  nowSeconds: number,
  options: { test?: boolean; postAt?: number } = {},
) {
  const opponents = fixtureOpponents(fixture);
  if (!opponents || !fixture.scheduledAt || fixture.status.toUpperCase() !== "SCHEDULED") {
    throw new HttpError(409, "The fixture does not have a scheduled time and reliable opponent codes.", "wdl_fixture_incomplete");
  }
  if (opponents.some((code) => !/^[A-Za-z0-9_-]{1,30}$/.test(code))) {
    throw new HttpError(409, "A WDL opponent code cannot safely be used in the event title.", "wdl_fixture_incomplete");
  }
  const matchTime = Math.floor(Date.parse(fixture.scheduledAt) / 1000);
  const briefing = matchTime - 30 * 60;
  if (briefing <= nowSeconds) throw new HttpError(409, "Briefing has already started; review this fixture manually.", "wdl_fixture_late");
  const title = `${options.test ? "[TEST] " : ""}RMNT v ${opponents.join(" v ")}`;
  let temporaryRole = title;
  if (options.test || names.roleNames.includes(title.toLowerCase())) {
    if (fixture.number === null || !Number.isSafeInteger(fixture.number)) throw new HttpError(409, "A unique fixture number is required for the temporary role.", "wdl_role_collision");
    temporaryRole = `${title} #${fixture.number}`;
  }
  if (temporaryRole.length > 100 || names.roleNames.includes(temporaryRole.toLowerCase())) {
    throw new HttpError(409, "The temporary role name is too long or already exists; review this fixture manually.", "wdl_role_collision");
  }
  const competition = fixture.competition;
  const description = [
    `**Briefing Start:** <t:${briefing}:F>`,
    `**Match Start:** <t:${matchTime}:F>`,
    `**Competition:** ${clean(competition?.competition)} / ${clean(competition?.season)}`,
    `**Division:** ${clean(competition?.division)} / Round ${competition?.round ?? "TBD"}`,
    `**Map:** ${clean(fixture.map)}`,
    `**Factions:** ${fixture.participants.map((p) => `${clean(p.team.code)}: ${clean(p.faction)}`).join(" | ")}`,
  ].join("\n");
  const postAt = options.postAt ?? briefing - TEN_DAYS;
  return {
    leaderId: WDL_LEADER,
    coLeaders: [WDL_COLEADER],
    templateId: "ct34",
    date: String(briefing),
    time: String(briefing),
    title,
    description,
    ...(postAt > nowSeconds ? { schedule: postAt } : {}),
    advancedSettings: {
      deadline: 0,
      lock_at_limit: false,
      limit_per_user: 1,
      allow_duplicate: false,
      apply_unregister: true,
      opt_out: "none",
      mentions: names.role,
      allowed_roles: names.role,
      voice_channel: names.voice,
      temp_voicechannel: "false",
      temp_role: temporaryRole,
      tr_include: "signed+tentative",
      response: "none",
      vacuum: false,
      deletion: false,
      pin_message: false,
      create_discordevent: false,
      create_thread: false,
      show_countdown: false,
      reminder: options.test ? false : 60,
      color: "#9E303C",
      image: EVENT_IMAGE,
      header_image: "default",
    },
  };
}

function raidUrl(path: string): string {
  return `${env().RAID_HELPER_BASE_URL.replace(/\/+$/, "")}${path}`;
}
const raidHeaders = () => ({ Authorization: env().RAID_HELPER_API_TOKEN });

export async function createWdlRaidEvent(channelId: string, body: ReturnType<typeof wdlEventBody>) {
  if (![WDL_EVENT_CHANNEL, WDL_TEST_CHANNEL].includes(channelId)) throw new HttpError(400, "Invalid Raid Helper event channel.", "invalid_channel");
  const { data } = await requestJson({
    provider: "raid-helper", method: "POST",
    url: raidUrl(`/api/v4/servers/${env().DISCORD_GUILD_ID}/channels/${channelId}/event`),
    headers: raidHeaders(), body, retries: 0, timeoutMs: 15000,
  });
  const parsed = z.object({ status: z.string(), event: z.object({ id: z.string().min(1) }) }).safeParse(data);
  if (!parsed.success) throw new Error("Raid Helper returned an unrecognised event-creation response; check Discord before retrying.");
  if (!["success", "ok"].includes(parsed.data.status.toLowerCase())) {
    throw new Error("Raid Helper did not confirm successful creation; check Discord before retrying.");
  }
  return parsed.data;
}

export async function getScheduledWdlEvents() {
  const { data } = await requestJson({ provider: "raid-helper", url: raidUrl(`/api/v4/servers/${env().DISCORD_GUILD_ID}/scheduledevents`), headers: raidHeaders() });
  const schema = z.object({ scheduledEvents: z.array(z.object({
    id: z.string(), channelId: z.string(), title: z.string(), startTime: z.number(), postTime: z.number(),
  })) });
  return schema.parse(data).scheduledEvents;
}

export async function getPostedWdlEvents() {
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

export async function getRawWdlEvent(eventId: string) {
  if (!/^[\w-]{1,64}$/.test(eventId)) throw new HttpError(400, "Invalid Raid Helper event ID.", "invalid_event");
  const { data } = await requestJson({ provider: "raid-helper", url: raidUrl(`/api/v4/events/${encodeURIComponent(eventId)}`), headers: raidHeaders() });
  return z.object({
    id: z.string(), serverId: z.string(), channelId: z.string(), title: z.string(),
    templateId: z.string(), startTime: z.number(), scheduledId: z.string().nullable().optional(),
  }).passthrough().parse(data);
}

export async function deleteWdlRaidEvent(eventId: string) {
  if (!/^[\w-]{1,64}$/.test(eventId)) throw new HttpError(400, "Invalid Raid Helper event ID.", "invalid_event");
  const { data } = await requestJson({ provider: "raid-helper", method: "DELETE", url: raidUrl(`/api/v4/events/${encodeURIComponent(eventId)}`),
    headers: raidHeaders(), retries: 0 });
  const result = z.object({ status: z.string() }).safeParse(data);
  if (!result.success || !["success", "ok"].includes(result.data.status.toLowerCase())) {
    throw new Error("Raid Helper did not confirm event deletion.");
  }
}
