import { z } from "zod";
import { requireOwner } from "@/lib/admin";
import { protectedRoute } from "@/lib/apiGuard";
import { wdlCreatedEventLog } from "@/server/services/wdlRaid";

export const dynamic = "force-dynamic";
const cursor = z.string().refine((value) => /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n).nullable();

export const GET = protectedRoute(async ({ session, req }) => {
  requireOwner(session);
  return wdlCreatedEventLog(cursor.parse(req.nextUrl.searchParams.get("before")));
});
