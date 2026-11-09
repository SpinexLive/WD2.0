import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/admin";
import { protectedRoute } from "@/lib/apiGuard";
import { HttpError } from "@/lib/http";
import { memberCsv } from "@/lib/memberCsv";
import { getClanMembers } from "@/server/services/discord";
import { resolveLinks } from "@/server/services/links";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async ({ session }) => {
  requireOwner(session);
  const [clan, links] = await Promise.all([getClanMembers(true), resolveLinks(true)]);
  if (clan.stale) throw new HttpError(503, "Discord members are unavailable or out of date. Try exporting again later.", "members_unavailable");
  if (!links.source.available || links.source.stale) throw new HttpError(503, "Steam links are unavailable or out of date. Try exporting again later.", "links_unavailable");

  const csv = memberCsv(clan.data.map((member) => ({
    displayName: member.displayName,
    username: member.username,
    steamId: links.steamIds.get(member.id) ?? null,
  })));
  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="remnant-members.csv"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
