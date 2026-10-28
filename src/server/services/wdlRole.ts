import { env } from "@/lib/env";
import { query, tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { invalidate } from "@/lib/cache";
import { HttpError, ProviderError, requestJson } from "@/lib/http";
import type { Session } from "@/lib/session";
import { getGuildMembers, type DiscordMember } from "./discord";
import { getLeagueMembers, type LeagueMember } from "./wardogsLeague";
import { DiscordAPIError, REST, Routes } from "discord.js";

const API = "https://discord.com/api/v10";
const LOCK = 331022;
const bot = () => ({ Authorization: `Bot ${env().DISCORD_BOT_TOKEN}` });
// Keep bucket state across syncs and development reloads. REST queues requests
// using Discord's response headers and waits out Retry-After, including long 429s.
const restState = globalThis as unknown as { __wdlRoleRest?: REST };
const roleRest = () => (restState.__wdlRoleRest ??= new REST({ version: "10", rejectOnRateLimit: null }).setToken(env().DISCORD_BOT_TOKEN));
interface Role { id: string; name: string; position: number; managed: boolean; permissions: string }
interface Settings { role_id: string | null; last_synced_at: Date | null; last_added: number; last_error: string | null }

/** Only roles below the bot's highest role can be assigned, even with Administrator. */
export async function assignableWdlRoles() {
  const guild = env().DISCORD_GUILD_ID;
  const [rolesResult, me] = await Promise.all([
    requestJson({ provider: "discord", url: `${API}/guilds/${guild}/roles`, headers: bot() }),
    requestJson({ provider: "discord", url: `${API}/users/@me`, headers: bot() }),
  ]);
  const roles = rolesResult.data as Role[];
  const member = await requestJson({ provider: "discord", url: `${API}/guilds/${guild}/members/${(me.data as { id: string }).id}`, headers: bot() });
  const ownIds = (member.data as { roles: string[] }).roles;
  const own = roles.filter((r) => ownIds.includes(r.id) || r.id === guild);
  const permissions = own.reduce((p, r) => p | BigInt(r.permissions), 0n);
  if (!(permissions & ((1n << 28n) | (1n << 3n)))) {
    throw new HttpError(400, "The bot needs the Manage Roles permission.", "bot_permission");
  }
  // Discord breaks equal-position ties by snowflake: the older role ranks higher.
  const highest = own.sort((a, b) => b.position - a.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1))[0];
  return roles.filter((r) => !r.managed && r.id !== guild && highest &&
    (r.position < highest.position || (r.position === highest.position && BigInt(r.id) > BigInt(highest.id))))
    .sort((a, b) => b.position - a.position || a.name.localeCompare(b.name))
    .map(({ id, name }) => ({ id, name }));
}

export function wdlRoleRecipients(members: DiscordMember[], league: LeagueMember[], roleId: string, clanRoleId: string) {
  const registered = new Set(league.map((m) => m.discordId));
  return members.filter((m) => !m.bot && m.roles.includes(clanRoleId) && registered.has(m.id) && !m.roles.includes(roleId));
}

export async function getWdlRoleStatus() {
  const [settings] = await query<Settings>("SELECT role_id, last_synced_at, last_added, last_error FROM wdl_role_settings WHERE id = true");
  let roles: { id: string; name: string }[] = [];
  let rolesError: string | null = null;
  try { roles = await assignableWdlRoles(); } catch (err) { rolesError = (err as Error).message; }
  return { roleId: settings?.role_id ?? null, lastSyncedAt: settings?.last_synced_at?.toISOString() ?? null,
    lastAdded: settings?.last_added ?? 0, lastError: settings?.last_error ?? null, roles, rolesError };
}

export async function saveWdlRole(actor: Session, roleId: string | null) {
  if (roleId && !(await assignableWdlRoles()).some((r) => r.id === roleId)) {
    throw new HttpError(400, "Choose a role below the bot's highest role that is not managed by an integration.", "invalid_role");
  }
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK]);
    await client.query("UPDATE wdl_role_settings SET role_id = $1, last_synced_at = NULL, last_added = 0, last_error = NULL WHERE id = true", [roleId]);
    await audit(actor, "wdl_role.configure", "role", roleId, { roleId });
  });
  return roleId ? syncWdlRole(actor) : { ok: true, added: 0, disabled: true };
}

/** Adds roles only; disabling or changing the selection never removes existing roles. */
export async function syncWdlRole(actor: Pick<Session, "discordId" | "displayName">) {
  return tx(async (client) => {
    const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_xact_lock($1) AS locked", [LOCK]);
    if (!lock.rows[0]?.locked) throw new HttpError(409, "A WDL role sync is already running. Try again shortly.", "sync_busy");
    const settings = await client.query<Settings>("SELECT role_id FROM wdl_role_settings WHERE id = true");
    const roleId = settings.rows[0]?.role_id;
    if (!roleId) return { ok: true, added: 0, disabled: true };
    let added = 0;
    let error: string | null = null;
    try {
      if (!(await assignableWdlRoles()).some((r) => r.id === roleId)) {
        throw new Error("The selected role is missing or above the bot's highest role. Choose an assignable role.");
      }
      const [members, league] = await Promise.all([getGuildMembers(true), getLeagueMembers(true)]);
      if (members.stale || league.stale) throw new Error("Discord or WDL data is outdated. No roles were assigned; try again later.");
      for (const member of wdlRoleRecipients(members.data, league.data, roleId, env().DISCORD_MEMBER_ROLE_ID)) {
        try {
          await roleRest().put(Routes.guildMemberRole(env().DISCORD_GUILD_ID, member.id, roleId));
          added++;
        } catch (err) {
          if (err instanceof DiscordAPIError && String(err.code) === "10007") continue; // Member left during the sync.
          throw err;
        }
      }
    } catch (err) {
      error = (err instanceof ProviderError || err instanceof DiscordAPIError) && err.status === 403
        ? "The bot could not assign the role. Check Manage Roles and its role position."
        : (err as Error).message;
    }
    if (added) invalidate("discord:guild-members");
    await client.query("UPDATE wdl_role_settings SET last_synced_at = now(), last_added = $1, last_error = $2 WHERE id = true", [added, error]);
    await audit(actor, "wdl_role.sync", "role", roleId, { added, error });
    return { ok: error === null, added, error };
  });
}

const g = globalThis as unknown as { __wdlRoleTimer?: NodeJS.Timeout };
export function startWdlRoleScheduler() {
  if (process.env.NEXT_PHASE === "phase-production-build" || g.__wdlRoleTimer) return;
  const run = async () => {
    try { await syncWdlRole({ discordId: "system", displayName: "WDL role scheduler" }); }
    catch (err) { console.error("WDL role sync failed:", (err as Error).message); }
    g.__wdlRoleTimer = setTimeout(run, 5 * 60_000);
    g.__wdlRoleTimer.unref?.();
  };
  g.__wdlRoleTimer = setTimeout(run, 30_000);
  g.__wdlRoleTimer.unref?.();
}
