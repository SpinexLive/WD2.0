import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { ZodError } from "zod";
import { getSession, type Session } from "./session";
import { rateLimit } from "./ratelimit";
import { env } from "./env";
import { HttpError, ProviderError } from "./http";

export interface Ctx<P = Record<string, string>> {
  req: NextRequest;
  session: Session;
  params: P;
}

type Handler<P> = (ctx: Ctx<P>) => Promise<unknown>;

export interface GuardOptions {
  /** Let signed-in clan members (no authorised role) call this route. Everything else is staff-only. */
  allowMember?: boolean;
  /** Mutations are refused while a staff member is previewing as someone else, unless the route opts in. */
  allowWhileViewing?: boolean;
  /** Only holders of the scouting reviewer role (staff status doesn't matter). */
  reviewerOnly?: boolean;
  /** Reviewers or staff (staff need to read notes in order to moderate them). */
  reviewerOrStaff?: boolean;
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: { message: err.message, code: err.code, ...err.extra } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json({ error: { message: `Invalid input: ${err.issues.map((i) => `${i.path.join(".") || "body"} ${i.message}`).join("; ")}`, code: "invalid_input" } }, { status: 400 });
  }
  if (err instanceof ProviderError) {
    const status = err.status === 429 ? 503 : 502;
    return NextResponse.json({ error: { message: err.message, code: "provider_error", provider: err.provider } }, { status });
  }
  console.error("Unhandled API error:", err instanceof Error ? `${err.name}: ${err.message}` : "unknown");
  return NextResponse.json({ error: { message: "Internal server error", code: "internal" } }, { status: 500 });
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Wraps every protected API route: session check (which also re-validates the
 * Discord role periodically), CSRF + Origin checks for mutations, and rate limiting.
 */
export function protectedRoute<P = Record<string, string>>(handler: Handler<P>, options: GuardOptions = {}) {
  return async (req: NextRequest, routeCtx: { params: Promise<P> }): Promise<NextResponse> => {
    try {
      const session = await getSession();
      if (!session) throw new HttpError(401, "Not signed in or access revoked", "unauthenticated");
      if (options.reviewerOrStaff) {
        if (!session.isReviewer && !session.isAdmin) throw new HttpError(403, "Scouting feedback is limited to reviewers and staff", "forbidden");
      } else if (options.reviewerOnly) {
        if (!session.isReviewer) throw new HttpError(403, "Scouting feedback is limited to the reviewer role", "forbidden");
      } else if (!session.isAdmin && !options.allowMember) throw new HttpError(403, "This area is for REMNANT staff only", "forbidden");

      const mutating = req.method !== "GET" && req.method !== "HEAD";
      if (mutating) {
        if (session.viewingAs && !options.allowWhileViewing) throw new HttpError(403, "You're viewing as another member (read-only). Exit view-as to make changes.", "view_as_readonly");
        const origin = req.headers.get("origin");
        if (!origin || origin !== new URL(env().APP_URL).origin) throw new HttpError(403, "Cross-origin request rejected", "bad_origin");
        const token = req.headers.get("x-csrf-token");
        if (!token || !safeEqual(token, session.csrfToken)) throw new HttpError(403, "Missing or invalid CSRF token", "bad_csrf");
      }

      const wait = await rateLimit(`api:${mutating ? "w" : "r"}:${session.discordId}`, mutating ? 30 : 120, 60);
      if (wait > 0) throw new HttpError(429, `Too many requests. Retry in ${wait}s.`, "rate_limited");

      const result = await handler({ req, session, params: await routeCtx.params });
      return result instanceof NextResponse ? result : NextResponse.json(result);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
