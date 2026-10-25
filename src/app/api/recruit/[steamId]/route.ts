import { protectedRoute } from "@/lib/apiGuard";
import { recruitUpdateSchema, setRecruitStatus } from "@/server/services/recruit";

export const dynamic = "force-dynamic";

export const PUT = protectedRoute<{ steamId: string }>(async ({ req, session, params }) =>
  setRecruitStatus(session, params.steamId, recruitUpdateSchema.parse(await req.json().catch(() => null))),
);
