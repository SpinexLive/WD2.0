import { NextResponse } from "next/server";
import { protectedRoute } from "@/lib/apiGuard";
import { destroyCurrentSession, SESSION_COOKIE } from "@/lib/session";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const POST = protectedRoute(async ({ session }) => {
  await destroyCurrentSession();
  await audit(session, "logout", "user", session.discordId);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete({ name: SESSION_COOKIE, path: "/" });
  return res;
});
