import { env } from "@/lib/env";
import { cached } from "@/lib/cache";
import { fetchGuildMember, getAllClanMembers, getClanMembers } from "./discord";
import { getEvents, type RaidHelperEvent } from "./raidHelper";
import { getServers } from "./wardogsRcon";
import { listNews, type NewsPost } from "./news";
import { getVoice } from "./voice";

export interface LandingEvent {
  id: string;
  title: string;
  startTime: number;
  signupCount: number | null;
  discordUrl: string | null;
}
export interface LandingVoiceChannel {
  id: string;
  name: string;
  members: { id: string; name: string; avatarUrl: string }[];
}
export interface LandingData {
  events: LandingEvent[] | null;
  voice: { channels: LandingVoiceChannel[]; total: number } | null;
  news: NewsPost[] | null;
  server: { name: string | null; online: boolean | null; players: number | null; map: string | null } | null;
  memberCount: number | null;
  inviteUrl: string | null;
}

const safe = async <T>(fn: () => Promise<T>): Promise<T | null> => {
  try {
    return await fn();
  } catch {
    return null;
  }
};

/** Events still to come (or started within the last 3 hours), nearest first. */
export function upcomingEvents(events: RaidHelperEvent[], now = Date.now(), limit = 3): LandingEvent[] {
  return events
    .filter((e): e is RaidHelperEvent & { startTime: number } => e.startTime !== null && e.startTime * 1000 > now - 3 * 3600_000)
    .sort((a, b) => a.startTime - b.startTime)
    .slice(0, limit)
    .map((e) => ({ id: e.id, title: e.title, startTime: e.startTime, signupCount: e.signupCount, discordUrl: e.discordUrl }));
}

async function voiceMembers(): Promise<LandingData["voice"]> {
  const snap = getVoice();
  if (!snap) return null;
  const clan = new Map((await safe(() => getClanMembers()))?.data.map((m) => [m.id, m]) ?? []);
  const channels: LandingVoiceChannel[] = [];
  for (const ch of snap.channels) {
    const members: LandingVoiceChannel["members"] = [];
    for (const id of ch.userIds.slice(0, 50)) {
      let m: { displayName: string; avatarUrl: string; bot?: boolean } | null | undefined = clan.get(id);
      if (!m) m = (await safe(() => cached(`landing:member:${id}`, 10 * 60_000, () => fetchGuildMember(id))))?.data;
      if (m && !m.bot) members.push({ id, name: m.displayName, avatarUrl: m.avatarUrl });
    }
    if (members.length) channels.push({ id: ch.id, name: ch.name, members });
  }
  channels.sort((a, b) => b.members.length - a.members.length);
  return { channels, total: channels.reduce((n, c) => n + c.members.length, 0) };
}

async function serverStatus(): Promise<LandingData["server"]> {
  const servers = (await getServers()).data;
  const wanted = env().WARDOGS_RCON_SERVER_ID;
  const s = servers.find((x) => x.id === wanted) ?? servers[0];
  return s ? { name: s.name, online: s.online, players: s.players, map: s.map } : null;
}

interface RawWidget {
  instant_invite?: string | null;
  channels?: { id: string; name: string; position?: number }[];
  members?: { id?: string; username?: string; avatar_url?: string; channel_id?: string | null }[];
}

/** Active voice channels and their users, from Discord's public server widget. */
async function widgetVoice(): Promise<{ voice: NonNullable<LandingData["voice"]>; invite: string | null }> {
  const { data } = await cached("landing:widget", 30_000, async () => {
    const res = await fetch(`https://discord.com/api/guilds/${env().DISCORD_GUILD_ID}/widget.json`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`widget ${res.status}`);
    return (await res.json()) as RawWidget;
  });
  const channels: LandingVoiceChannel[] = [];
  for (const ch of [...(data.channels ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    const members = (data.members ?? [])
      .filter((m) => m.channel_id === ch.id && m.id && m.username)
      .map((m) => ({ id: m.id!, name: m.username!, avatarUrl: m.avatar_url ?? "" }));
    if (members.length) channels.push({ id: ch.id, name: ch.name, members });
  }
  return { voice: { channels, total: channels.reduce((n, c) => n + c.members.length, 0) }, invite: data.instant_invite ?? null };
}
export async function getLandingData(): Promise<LandingData> {
  const [events, widgetResult, news, server, members] = await Promise.all([
    safe(async () => upcomingEvents((await getEvents()).data)),
    safe(widgetVoice),
    safe(() => listNews(5)),
    safe(serverStatus),
    safe(() => getAllClanMembers()),
  ]);
  const voice = widgetResult?.voice ?? (await safe(voiceMembers));
  return { events, voice, news, server, memberCount: members ? members.data.length : null, inviteUrl: env().DISCORD_INVITE_URL ?? widgetResult?.invite ?? null };
}
