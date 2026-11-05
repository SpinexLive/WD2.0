import { query } from "@/lib/db";
import { wdlFixtureSchema, type WdlFixtures } from "@/lib/wdlFixtures";
import { getLeagueFixtures } from "./wardogsLeague";

export async function archiveWdlFixtures(fixtures: WdlFixtures): Promise<void> {
  if (!fixtures.upcoming.length && !fixtures.recent.length) return;
  await query(
    `WITH updated_upcoming AS (
       UPDATE wdl_fixture_archive AS archive
       SET fixture = item, is_result = false, last_seen_at = now()
       FROM jsonb_array_elements($1::jsonb) item
       WHERE archive.fixture_id = item->>'id'
     )
     INSERT INTO wdl_fixture_archive (fixture_id, fixture, is_result)
     SELECT item->>'id', item, true FROM jsonb_array_elements($2::jsonb) item
     ON CONFLICT (fixture_id) DO UPDATE SET fixture = EXCLUDED.fixture, is_result = true, last_seen_at = now()`,
    [JSON.stringify(fixtures.upcoming), JSON.stringify(fixtures.recent)],
  );
}

export async function fixtureOverview(force = false) {
  let snapshot: Awaited<ReturnType<typeof getLeagueFixtures>> | null = null;
  let error: string | null = null;
  try {
    snapshot = await getLeagueFixtures(force);
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load WDL fixtures.";
  }
  if (snapshot && !snapshot.stale) await archiveWdlFixtures(snapshot.data);
  const rows = await query<{ fixture: unknown; is_result: boolean }>("SELECT fixture, is_result FROM wdl_fixture_archive ORDER BY last_seen_at DESC");
  const links = await query<{ fixture_id: string; state: string; event_id: string | null }>(
    "SELECT fixture_id, state, event_id FROM wdl_fixture_events WHERE NOT baseline",
  );
  const archived = rows.map((row) => ({ fixture: wdlFixtureSchema.parse(row.fixture), isResult: row.is_result }));
  const archivedIds = new Set(archived.map(({ fixture }) => fixture.id));
  const recent = new Map(archived.filter(({ isResult }) => isResult).map(({ fixture }) => [fixture.id, fixture]));
  for (const fixture of snapshot?.data.recent ?? []) if (!snapshot?.stale || !archivedIds.has(fixture.id)) recent.set(fixture.id, fixture);
  const upcoming = snapshot?.data.upcoming ?? null;
  return {
    upcoming: snapshot?.stale ? upcoming?.filter((fixture) => !recent.has(fixture.id)) ?? null : upcoming,
    recent: [...recent.values()].sort((a, b) => (Date.parse(b.scheduledAt ?? "") || 0) - (Date.parse(a.scheduledAt ?? "") || 0)),
    links: Object.fromEntries(links.map((link) => [link.fixture_id, { state: link.state, eventId: link.event_id }])),
    source: { available: snapshot !== null, fetchedAt: snapshot?.fetchedAt ?? null, stale: snapshot?.stale ?? false, error: snapshot?.error ?? error },
  };
}
export type WdlFixtureOverview = Awaited<ReturnType<typeof fixtureOverview>>;
