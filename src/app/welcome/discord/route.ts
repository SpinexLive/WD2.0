import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { createSession, sessionCookieOptions, SESSION_COOKIE, STATE_COOKIE } from "@/lib/session";
import { exchangeCode, fetchOwnGuildMember, hasAuthorisedRole, hasMemberRole } from "@/server/services/discord";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

function deny(reason: string) {
  const res = NextResponse.redirect(new URL(`/login?error=${reason}`, env().APP_URL));
  res.cookies.delete({ name: STATE_COOKIE, path: "/" });
  return res;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;

  if (req.nextUrl.searchParams.get("error")) return deny("cancelled");
  if (!code || !state || !cookieState || state.length !== cookieState.length || !timingSafeEqual(Buffer.from(state), Buffer.from(cookieState))) return deny("state");

  // State is single-use.
  const used = await query("DELETE FROM oauth_states WHERE state = $1 AND created_at > now() - interval '15 minutes' RETURNING state", [state]);
  if (used.length === 0) return deny("state");

  try {
    const accessToken = await exchangeCode(code);
    const member = await fetchOwnGuildMember(accessToken);
    if (!member) return deny("not_in_guild");
    if (!hasAuthorisedRole(member.roles) && !hasMemberRole(member.roles)) {
      await audit({ discordId: member.id, displayName: member.displayName }, "login.denied", "user", member.id);
      return deny("forbidden");
    }
    const { token, expires } = await createSession(member);
    await audit({ discordId: member.id, displayName: member.displayName }, "login", "user", member.id);

    const res = NextResponse.redirect(new URL("/today", env().APP_URL));
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expires));
    res.cookies.delete({ name: STATE_COOKIE, path: "/" });
    return res;
  } catch (err) {
    console.error("Discord login failed:", (err as Error).message);
    return deny("discord_error");
  }
}
