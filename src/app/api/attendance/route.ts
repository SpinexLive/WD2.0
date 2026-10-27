import { z } from "zod";
import { protectedRoute } from "@/lib/apiGuard";
import { getAttendanceReport } from "@/server/services/attendance";

export const dynamic = "force-dynamic";

const DAYS = { "30d": 30, "90d": 90, all: null } as const;
const schema = z.object({ range: z.enum(["30d", "90d", "all"]).default("30d") });

export const GET = protectedRoute(async ({ req }) => {
  const { range } = schema.parse(Object.fromEntries(req.nextUrl.searchParams));
  return { range, ...(await getAttendanceReport(DAYS[range])) };
});
