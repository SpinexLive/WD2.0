import { z } from "zod";
import { requireOwner } from "@/lib/admin";
import { protectedRoute } from "@/lib/apiGuard";
import { approveWdlRaidTest, checkWdlRaidTest, clearUncertainWdlTest, createWdlRaidTest, deleteReviewedWdlEvent, disableWdlRaidAutomation, linkExistingWdlEvent, recoverScheduledWdlEvent, recoverWdlRaidTest, retryReviewedWdlFixture, wdlRaidStatus } from "@/server/services/wdlRaid";

export const dynamic = "force-dynamic";
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("test") }).strict(),
  z.object({ action: z.literal("check") }).strict(),
  z.object({ action: z.literal("approve"), testId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("disable") }).strict(),
  z.object({ action: z.literal("link"), fixtureId: z.string().min(1).max(128), eventId: z.string().regex(/^[\w-]{1,64}$/) }).strict(),
  z.object({ action: z.literal("link-scheduled"), fixtureId: z.string().min(1).max(128), scheduledId: z.string().regex(/^[\w-]{1,64}$/) }).strict(),
  z.object({ action: z.literal("recover-test"), testId: z.string().uuid(), scheduledId: z.string().regex(/^[\w-]{1,64}$/) }).strict(),
  z.object({ action: z.literal("clear-test"), testId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("retry"), fixtureId: z.string().min(1).max(128) }).strict(),
  z.object({ action: z.literal("delete"), fixtureId: z.string().min(1).max(128) }).strict(),
]);

export const GET = protectedRoute(async ({ session }) => { requireOwner(session); return wdlRaidStatus(); });
export const POST = protectedRoute(async ({ session, req }) => {
  requireOwner(session);
  const input = action.parse(await req.json());
  switch (input.action) {
    case "test": return createWdlRaidTest(session);
    case "check": return checkWdlRaidTest();
    case "approve": return approveWdlRaidTest(input.testId, session);
    case "disable": return disableWdlRaidAutomation(session);
    case "link": return linkExistingWdlEvent(input.fixtureId, input.eventId, session);
    case "link-scheduled": return recoverScheduledWdlEvent(input.fixtureId, input.scheduledId, session);
    case "recover-test": return recoverWdlRaidTest(input.testId, input.scheduledId, session);
    case "clear-test": return clearUncertainWdlTest(input.testId, session);
    case "retry": return retryReviewedWdlFixture(input.fixtureId, session);
    case "delete": return deleteReviewedWdlEvent(input.fixtureId, session);
  }
});
