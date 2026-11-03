import { protectedRoute } from "@/lib/apiGuard";
import { requireOwner } from "@/lib/admin";
import { recruitTestPlayers, recruitTestSchema, sendRecruitTest } from "@/server/services/recruitTest";

export const dynamic = "force-dynamic";
export const GET = protectedRoute(async ({ session }) => {
  requireOwner(session);
  return recruitTestPlayers();
});
export const POST = protectedRoute(async ({ session, req }) => {
  requireOwner(session);
  return sendRecruitTest(recruitTestSchema.parse(await req.json()), session);
});
