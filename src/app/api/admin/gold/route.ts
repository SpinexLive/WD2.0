import { z } from "zod";
import { protectedRoute } from "@/lib/apiGuard";
import { requireOwner } from "@/lib/admin";
import { createGoldChannel, getGoldStatus, removeGoldChannel, updateGoldChannel } from "@/server/services/gold";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async ({ session }) => {
  requireOwner(session);
  return getGoldStatus();
});

export const POST = protectedRoute(async ({ req, session }) => {
  requireOwner(session);
  const { categoryId } = z.object({ categoryId: z.string().regex(/^\d{17,20}$/) }).strict().parse(await req.json().catch(() => null));
  return createGoldChannel(session, categoryId);
});

/** Fetches today's price now and renames the channel. */
export const PUT = protectedRoute(async ({ session }) => {
  requireOwner(session);
  return updateGoldChannel(session, true);
});

export const DELETE = protectedRoute(async ({ session }) => {
  requireOwner(session);
  return removeGoldChannel(session);
});
