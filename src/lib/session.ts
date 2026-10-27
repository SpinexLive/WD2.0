import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { query } from "./db";
import { env, isProduction } from "./env";
import { fetchGuildMember, getAllClanMembers, hasAuthorisedRole, hasMemberRole, type DiscordMember } from "@/server/services/discord";
import { ProviderError } from "./http";

export const SESSION_COOKIE = isProduction ? "__Host-remnant_session" : "remnant_session";
export const VIEWAS_COOKIE = "remnant_viewas";
export const STATE_COOKIE = "remnant_oauth_state";
const SESSION_TTL_MS = 12 * 60 * 60_000;
/** How often Discord roles are re-checked while a user is active. */
const REVALIDATE_MS = 5 * 60_000;
/** If Discord is unreachable, keep an existing session only while the last good check is this recent. */
const OFFLINE_GRACE_MS = 30 * 60_000;

export interface Session {
  id: string;
  discordId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  csrfToken: string;
  /** Holds an authorised role: full dashboard. Otherwise a clan member who may only see their own stats. */
  isAdmin: boolean;
  /** Set while a staff member is previewing the dashboard as this member (read-only). */
  viewingAs?: { adminId: string; adminName: string };
}

const hashToken = (token: string) => createHmac("sha256", env().SESSION_SECRET).update(token).digest("hex");

export async function createSession(member: DiscordMember): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  await query(
    `INSERT INTO sessions (id, discord_id, username, display_name, avatar_url, roles, csrf_token, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [hashToken(token), member.id, member.username, member.displayName, member.avatarUrl, member.roles, randomBytes(24).toString("base64url"), expires],
  );
  await query("DELETE FROM sessions WHERE expires_at < now()");
  return { token, expires };
}

export function sessionCookieOptions(expires: Date) {
  return { httpOnly: true, secure: isProduction, sameSite: "lax" as const, path: "/", expires };
}

interface Row {
  id: string;
  discord_id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  csrf_token: string;
  roles: string[];
  stale_ms: number;
}

async function getRealSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 128) return null;
  const id = hashToken(token);
  const [row] = await query<Row>(
    `SELECT id, discord_id, username, display_name, avatar_url, csrf_token, roles,
            (extract(epoch FROM now() - roles_checked_at) * 1000)::bigint::float8 AS stale_ms
       FROM sessions WHERE id = $1 AND expires_at > now()`,
    [id],
  );
  if (!row) return null;

  if (row.stale_ms > REVALIDATE_MS) {
    try {
      const member = await fetchGuildMember(row.discord_id);
      if (!member || !(hasAuthorisedRole(member.roles) || hasMemberRole(member.roles))) {
        await query("DELETE FROM sessions WHERE discord_id = $1", [row.discord_id]);
        return null;
      }
      await query("UPDATE sessions SET roles = $2, display_name = $3, avatar_url = $4, roles_checked_at = now() WHERE id = $1", [id, member.roles, member.displayName, member.avatarUrl]);
      row.roles = member.roles;
      row.display_name = member.displayName;
      row.avatar_url = member.avatarUrl;
    } catch (err) {
      if (!(err instanceof ProviderError) || row.stale_ms > OFFLINE_GRACE_MS) return null;
    }
  }

  return { id, discordId: row.discord_id, username: row.username, displayName: row.display_name, avatarUrl: row.avatar_url, csrfToken: row.csrf_token, isAdmin: hasAuthorisedRole(row.roles ?? []) };
}

/**
 * The effective session. If a staff member has chosen "view as", the returned session is that clan member's
 * (non-admin, so every staff-only route is closed). The cookie is only honoured while the real session is staff.
 */
export async function getSession(): Promise<Session | null> {
  const real = await getRealSession();
  if (!real || !real.isAdmin) return real;
  const target = (await cookies()).get(VIEWAS_COOKIE)?.value;
  if (!target || !/^\d{5,25}$/.test(target) || target === real.discordId) return real;
  const members = await getAllClanMembers().then((s) => s.data, () => []);
  const m = members.find((x) => x.id === target);
  if (!m) return real;
  return { ...real, discordId: m.id, username: m.username, displayName: m.displayName, avatarUrl: m.avatarUrl, isAdmin: false, viewingAs: { adminId: real.discordId, adminName: real.displayName } };
}

/** The signed-in person regardless of any "view as" choice. */
export const getActualSession = getRealSession;

export async function destroyCurrentSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await query("DELETE FROM sessions WHERE id = $1", [hashToken(token)]);
}
