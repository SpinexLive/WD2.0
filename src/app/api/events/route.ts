import { protectedRoute } from "@/lib/apiGuard";
import { query } from "@/lib/db";
import { getEvents } from "@/server/services/raidHelper";
import { listTemplates } from "@/server/services/rosters";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async ({ req }) => {
  const snap = await getEvents(req.nextUrl.searchParams.get("refresh") === "1");
  const [rows, templates] = await Promise.all([
    query<{ raid_helper_event_id: string; status: string }>("SELECT raid_helper_event_id, status FROM rosters"),
    listTemplates(),
  ]);
  const byEvent = new Map(rows.map((r) => [r.raid_helper_event_id, r.status]));
  return {
    events: snap.data.map((e) => ({ ...e, rosterStatus: byEvent.get(e.id) ?? null })),
    templates: templates.map((t) => ({ key: t.key, name: t.name, eventType: t.eventType, positions: t.squads.reduce((n, s) => n + s.size, 0) })),
    source: { fetchedAt: snap.fetchedAt, stale: snap.stale, error: snap.error ?? null },
  };
});
