import { z } from "zod";
import { requireOwner } from "@/lib/admin";
import { protectedRoute } from "@/lib/apiGuard";
import { deleteReviewedWdlEvent, disableWdlRaidAutomation, enableWdlRaidAutomation, linkExistingWdlEvent, recoverScheduledWdlEvent, retryReviewedWdlFixture, wdlRaidStatus } from "@/server/services/wdlRaid";

export const dynamic = "force-dynamic";
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enable") }).strict(),
  z.object({ action: z.literal("disable") }).strict(),
  z.object({ action: z.literal("link"), fixtureId: z.string().min(1).max(128), eventId: z.string().regex(/^[\w-]{1,64}$/) }).strict(),
  z.object({ action: z.literal("link-scheduled"), fixtureId: z.string().min(1).max(128), scheduledId: z.string().regex(/^[\w-]{1,64}$/) }).strict(),
  z.object({ action: z.literal("retry"), fixtureId: z.string().min(1).max(128) }).strict(),
  z.object({ action: z.literal("delete"), fixtureId: z.string().min(1).max(128) }).strict(),
]);

export const GET = protectedRoute(async ({ session }) => { requireOwner(session); return wdlRaidStatus(); });
export const POST = protectedRoute(async ({ session, req }) => {
  requireOwner(session);
  const input = action.parse(await req.json());
  switch (input.action) {
    case "enable": return enableWdlRaidAutomation(session);
    case "disable": return disableWdlRaidAutomation(session);
    case "link": return linkExistingWdlEvent(input.fixtureId, input.eventId, session);
    case "link-scheduled": return recoverScheduledWdlEvent(input.fixtureId, input.scheduledId, session);
    case "retry": return retryReviewedWdlFixture(input.fixtureId, session);
    case "delete": return deleteReviewedWdlEvent(input.fixtureId, session);
  }
});
