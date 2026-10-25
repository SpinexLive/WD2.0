import { env } from "@/lib/env";
import { requestJson, ProviderError } from "@/lib/http";
import { cached, type Snapshot } from "@/lib/cache";

const API = "https://discord.com/api/v10";

export interface DiscordMember {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string;
  roles: string[];
  bot?: boolean;
}

interface RawUser {
  bot?: boolean;
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}
interface RawMember {
  user?: RawUser;
  nick?: string | null;
  avatar?: string | null;
  roles: string[];
}

const bot = () => ({ Authorization: `Bot ${env().DISCORD_BOT_TOKEN}` });

export function avatarUrl(user: RawUser): string {
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith("a_") ? "gif" : "png"}?size=64`;
  const index = Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function toMember(m: RawMember, fallback?: RawUser): DiscordMember {
  const user = m.user ?? fallback;
  if (!user) throw new ProviderError("discord", "Discord member payload had no user");
  return {
    id: user.id,
    username: user.username,
    displayName: m.nick || user.global_name || user.username,
    avatarUrl: avatarUrl(user),
    roles: m.roles,
    bot: user.bot === true,
  };
}

export function hasAuthorisedRole(roles: string[]): boolean {
  const allowed = new Set(env().DISCORD_ALLOWED_ROLE_IDS);
  return roles.some((r) => allowed.has(r));
}

/** Clan members (the Wardogs role) can sign in to see only their own stats. */
export function hasMemberRole(roles: string[]): boolean {
  return roles.includes(env().DISCORD_MEMBER_ROLE_ID);
}

// ---- OAuth2 (user token is used only during login and never stored) ----

export function authorizeUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: env().DISCORD_CLIENT_ID,
    redirect_uri: `${env().APP_URL}/welcome/discord`,
    response_type: "code",
    scope: "identify guilds.members.read",
    state,
    prompt: "none",
  });
  return `https://discord.com/oauth2/authorize?${p}`;
}

export async function exchangeCode(code: string): Promise<string> {
  const res = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env().DISCORD_CLIENT_ID,
      client_secret: env().DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${env().APP_URL}/welcome/discord`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new ProviderError("discord", "Discord rejected the login code", res.status);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new ProviderError("discord", "Discord returned no access token");
  return json.access_token;
}

/** Returns the signed-in user's guild member record, or null when they are not in the guild. */
export async function fetchOwnGuildMember(accessToken: string): Promise<DiscordMember | null> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const { status, data } = await requestJson({
    provider: "discord",
    url: `${API}/users/@me/guilds/${env().DISCORD_GUILD_ID}/member`,
    headers,
    okStatuses: [404],
  });
  if (status === 404) return null;
  const raw = data as RawMember;
  if (!raw.user) {
    const me = await requestJson({ provider: "discord", url: `${API}/users/@me`, headers });
    return toMember(raw, me.data as RawUser);
  }
  return toMember(raw);
}

// ---- Bot REST ----

/** Current guild member via the bot; null if they left the guild. Used for periodic role revalidation. */
export async function fetchGuildMember(userId: string): Promise<DiscordMember | null> {
  const { status, data } = await requestJson({
    provider: "discord",
    url: `${API}/guilds/${env().DISCORD_GUILD_ID}/members/${userId}`,
    headers: bot(),
    okStatuses: [404],
  });
  return status === 404 ? null : toMember(data as RawMember);
}

export async function getClanMembers(force = false): Promise<Snapshot<DiscordMember[]>> {
  const snap = await getGuildMembers(force);
  return { ...snap, data: snap.data.filter((m) => m.roles.includes(env().DISCORD_MEMBER_ROLE_ID)) };
}

/** Everyone holding the whole-clan role (includes members who don't play Wardogs). */
export async function getAllClanMembers(force = false): Promise<Snapshot<DiscordMember[]>> {
  const snap = await getGuildMembers(force);
  const role = env().DISCORD_CLAN_ROLE_ID;
  return { ...snap, data: snap.data.filter((m) => m.roles.includes(role)) };
}

function getGuildMembers(force = false): Promise<Snapshot<DiscordMember[]>> {
  return cached("discord:guild-members", 5 * 60_000, async () => {
    const all: DiscordMember[] = [];
    let after = "0";
    for (let page = 0; page < 50; page++) {
      const { data } = await requestJson({
        provider: "discord",
        url: `${API}/guilds/${env().DISCORD_GUILD_ID}/members?limit=1000&after=${after}`,
        headers: bot(),
      });
      const batch = data as RawMember[];
      if (!Array.isArray(batch)) throw new ProviderError("discord", "Unexpected guild members response");
      for (const m of batch) if (m.user && !(m.user as { bot?: boolean }).bot) all.push(toMember(m));
      if (batch.length < 1000) break;
      after = batch[batch.length - 1]!.user!.id;
    }
    return all;
  }, force);
}

export interface PostableChannel {
  id: string;
  name: string;
  category: string | null;
}

const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const EMBED_LINKS = 1n << 14n;
const ADMINISTRATOR = 1n << 3n;

interface Overwrite {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
}

/** Standard Discord permission resolution for the bot in one channel. */
export function botCanPost(opts: {
  guildId: string;
  botId: string;
  botRoleIds: string[];
  rolePerms: Map<string, bigint>;
  overwrites: Overwrite[];
}): boolean {
  const { guildId, botId, botRoleIds, rolePerms, overwrites } = opts;
  let perms = rolePerms.get(guildId) ?? 0n;
  for (const r of botRoleIds) perms |= rolePerms.get(r) ?? 0n;
  if (perms & ADMINISTRATOR) return true;

  const apply = (o?: Overwrite) => {
    if (o) perms = (perms & ~BigInt(o.deny)) | BigInt(o.allow);
  };
  apply(overwrites.find((o) => o.type === 0 && o.id === guildId));
  let deny = 0n;
  let allow = 0n;
  for (const o of overwrites) {
    if (o.type === 0 && botRoleIds.includes(o.id)) {
      deny |= BigInt(o.deny);
      allow |= BigInt(o.allow);
    }
  }
  perms = (perms & ~deny) | allow;
  apply(overwrites.find((o) => o.type === 1 && o.id === botId));

  const need = VIEW_CHANNEL | SEND_MESSAGES | EMBED_LINKS;
  return (perms & need) === need;
}

export function getPostableChannels(force = false): Promise<Snapshot<PostableChannel[]>> {
  return cached("discord:channels", 2 * 60_000, async () => {
    const guildId = env().DISCORD_GUILD_ID;
    const [me, roles, channels] = await Promise.all([
      requestJson({ provider: "discord", url: `${API}/users/@me`, headers: bot() }),
      requestJson({ provider: "discord", url: `${API}/guilds/${guildId}/roles`, headers: bot() }),
      requestJson({ provider: "discord", url: `${API}/guilds/${guildId}/channels`, headers: bot() }),
    ]);
    const botId = (me.data as { id: string }).id;
    const member = await requestJson({ provider: "discord", url: `${API}/guilds/${guildId}/members/${botId}`, headers: bot() });
    const botRoleIds = (member.data as RawMember).roles;
    const rolePerms = new Map((roles.data as { id: string; permissions: string }[]).map((r) => [r.id, BigInt(r.permissions)]));
    const list = channels.data as { id: string; name: string; type: number; parent_id?: string | null; permission_overwrites?: Overwrite[] }[];
    const names = new Map(list.map((c) => [c.id, c.name]));

    return list
      .filter((c) => (c.type === 0 || c.type === 5) && botCanPost({ guildId, botId, botRoleIds, rolePerms, overwrites: c.permission_overwrites ?? [] }))
      .map((c) => ({ id: c.id, name: c.name, category: c.parent_id ? (names.get(c.parent_id) ?? null) : null }))
      .sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.name.localeCompare(b.name));
  }, force);
}

// ---- Message publishing (reusable by any caller) ----

export interface DiscordMessagePayload {
  content?: string;
  embeds: unknown[];
  components?: unknown[];
  allowed_mentions: { parse: never[]; users?: string[] };
}

export class DiscordMessageMissing extends Error {}

function mapMessageError(err: unknown): never {
  if (err instanceof ProviderError && (err.code === "10008" || err.code === "10003")) throw new DiscordMessageMissing("The Discord message or channel no longer exists");
  if (err instanceof ProviderError && (err.code === "50001" || err.code === "50013")) {
    throw new ProviderError("discord", "The bot lacks permission to post in that channel", err.status, false, err.code);
  }
  throw err;
}

export async function postMessage(channelId: string, payload: DiscordMessagePayload): Promise<string> {
  try {
    const { data } = await requestJson({ provider: "discord", method: "POST", url: `${API}/channels/${channelId}/messages`, headers: bot(), body: payload, retries: 0 });
    return (data as { id: string }).id;
  } catch (err) {
    return mapMessageError(err);
  }
}

export async function editMessage(channelId: string, messageId: string, payload: DiscordMessagePayload): Promise<void> {
  try {
    await requestJson({ provider: "discord", method: "PATCH", url: `${API}/channels/${channelId}/messages/${messageId}`, headers: bot(), body: payload, retries: 1 });
  } catch (err) {
    mapMessageError(err);
  }
}

export async function deleteMessage(channelId: string, messageId: string): Promise<void> {
  await requestJson({ provider: "discord", method: "DELETE", url: `${API}/channels/${channelId}/messages/${messageId}`, headers: bot(), okStatuses: [404], retries: 1 });
}
