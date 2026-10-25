import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { query } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { authorizeUrl } from "@/server/services/discord";
import { isProduction } from "@/lib/env";
import { STATE_COOKIE } from "@/lib/session";
import { errorResponse } from "@/lib/apiGuard";
import { HttpError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if ((await rateLimit(`login:${ip}`, 20, 300)) > 0) throw new HttpError(429, "Too many login attempts", "rate_limited");

    const state = randomBytes(24).toString("base64url");
    await query("DELETE FROM oauth_states WHERE created_at < now() - interval '15 minutes'");
    await query("INSERT INTO oauth_states (state) VALUES ($1)", [state]);

    const res = NextResponse.redirect(authorizeUrl(state));
    res.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: isProduction, sameSite: "lax", path: "/api/auth", maxAge: 600 });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
