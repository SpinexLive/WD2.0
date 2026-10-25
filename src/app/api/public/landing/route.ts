import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/ratelimit";
import { getLandingData } from "@/server/services/landing";

export const dynamic = "force-dynamic";

/** Public, read-only data for the landing page. Nothing here needs a session; abuse is limited per client IP. */
export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const wait = await rateLimit(`public:landing:${ip}`, 60, 60).catch(() => 0);
  if (wait > 0) return NextResponse.json({ error: { message: `Too many requests. Retry in ${wait}s.`, code: "rate_limited" } }, { status: 429 });
  return NextResponse.json(await getLandingData(), { headers: { "Cache-Control": "no-store" } });
}
