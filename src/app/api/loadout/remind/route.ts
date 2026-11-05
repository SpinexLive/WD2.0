import { requireOwner } from "@/lib/admin";
import { protectedRoute } from "@/lib/apiGuard";
import { loadoutReminderSchema, previewLoadoutReminder, sendLoadoutReminder } from "@/server/services/loadoutReminder";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async ({ session }) => {
  requireOwner(session);
  return previewLoadoutReminder();
});

export const POST = protectedRoute(async ({ session, req }) => {
  requireOwner(session);
  return sendLoadoutReminder(loadoutReminderSchema.parse(await req.json()), session);
});
