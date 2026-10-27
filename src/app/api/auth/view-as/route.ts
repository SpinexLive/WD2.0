import { NextResponse } from "next/server";
import { z } from "zod";
import { protectedRoute } from "@/lib/apiGuard";
import { HttpError } from "@/lib/http";
import { audit } from "@/lib/audit";
import { sessionCookieOptions, VIEWAS_COOKIE } from "@/lib/session";
import { getAllClanMembers } from "@/server/services/discord";

export const dynamic = "force-dynamic";

/** Clan members a staff member can preview the dashboard as. */
export const GET = protectedRoute(async ({ session }) => {
  const members = await getAllClanMembers().then((s) => s.data);
  return { members: members.filter((m) => m.id !== session.discordId).map((m) => ({ id: m.id, name: m.displayName, avatarUrl: m.avatarUrl })).sort((a, b) => a.name.localeCompare(b.name)) };
});

const body = z.object({ discordId: z.string().regex(/^\d{5,25}$/) });

/** Start previewing as a clan member. Read-only: the effective session is that member's non-staff session. */
export const POST = protectedRoute(async ({ req, session }) => {
  const { discordId } = body.parse(await req.json().catch(() => null));
  const members = await getAllClanMembers().then((s) => s.data);
  const target = members.find((m) => m.id === discordId);
  if (!target) throw new HttpError(404, "That person isn't a clan member", "not_found");
  await audit(session, "view_as.start", "user", discordId, {});
  const res = NextResponse.json({ ok: true });
  res.cookies.set(VIEWAS_COOKIE, discordId, sessionCookieOptions(new Date(Date.now() + 4 * 60 * 60_000)));
  return res;
});

/** Stop previewing. Reachable while viewing as someone else. */
export const DELETE = protectedRoute(
  async () => {
    const res = NextResponse.json({ ok: true });
    res.cookies.delete({ name: VIEWAS_COOKIE, path: "/" });
    return res;
  },
  { allowMember: true, allowWhileViewing: true },
);
