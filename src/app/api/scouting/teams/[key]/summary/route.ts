import { protectedRoute } from "@/lib/apiGuard";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/ratelimit";
import { HttpError } from "@/lib/http";
import { generateSummary, teamDetail } from "@/server/services/scouting";

export const dynamic = "force-dynamic";

/** (Re)generates the AI overview from all observations. Limited so the AI quota can't be burned by repeated clicks. */
export const POST = protectedRoute<{ key: string }>(
  async ({ params, session }) => {
    const key = params.key.slice(0, 80);
    const wait = await     rateLimit(`scouting-ai:${key}`, 6, 300);
        if (wait > 0) throw new HttpError(429, `Too many overview attempts for this team. Try again in ${wait}s.`, "rate_limited");
    await generateSummary(key);
    await audit(session, "scouting.summary", "team", key, {});
    return teamDetail(key);
  },
  {},
);
