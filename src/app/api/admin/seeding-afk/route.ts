import { protectedRoute } from "@/lib/apiGuard";
import { requireOwner } from "@/lib/admin";
import { seedingSettingsSchema } from "@/lib/seedingAfk";
import { seedingStatus, saveSeedingSettings, publishSeedingEmbed } from "@/server/services/seedingAfk";

export const dynamic = "force-dynamic";
export const GET = protectedRoute(async ({ session }) => { requireOwner(session); return seedingStatus(); });
export const PUT = protectedRoute(async ({ session, req }) => {
  requireOwner(session);
  return saveSeedingSettings(seedingSettingsSchema.parse(await req.json()), session.discordId);
});
export const POST = protectedRoute(async ({ session }) => { requireOwner(session); return publishSeedingEmbed(session.discordId); });
