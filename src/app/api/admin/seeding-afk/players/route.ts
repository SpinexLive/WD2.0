import { z } from "zod";
import { protectedRoute } from "@/lib/apiGuard";
import { requireOwner } from "@/lib/admin";
import { seedingAdminPlayers, adminRegisterSeedingPlayer, adminRemoveSeedingPlayer } from "@/server/services/seedingAfk";

export const dynamic = "force-dynamic";
export const GET = protectedRoute(async ({ session }) => { requireOwner(session); return seedingAdminPlayers(); });
export const POST = protectedRoute(async ({ session, req }) => {
  requireOwner(session);
  const { steamId } = z.object({ steamId: z.string().regex(/^\d{17}$/) }).strict().parse(await req.json());
  return adminRegisterSeedingPlayer(steamId, session.discordId);
});
export const DELETE = protectedRoute(async ({ session, req }) => {
  requireOwner(session);
  const { discordId } = z.object({ discordId: z.string().regex(/^\d{17,20}$/) }).strict().parse(await req.json());
  return adminRemoveSeedingPlayer(discordId, session.discordId);
});
