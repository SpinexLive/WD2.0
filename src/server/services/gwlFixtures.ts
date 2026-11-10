import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { getGwlFixtures, gwlFixtureSchema, type GwlFixture } from "./gwl";

export async function archiveGwlFixtures(fixtures: { upcoming: GwlFixture[]; recent: GwlFixture[] }): Promise<void> {
  await query(
    `WITH updated_upcoming AS (
       UPDATE gwl_fixture_archive AS archive
       SET fixture = item, is_result = false, last_seen_at = now()
       FROM jsonb_array_elements($1::jsonb) item
       WHERE archive.match_number = item->>'number'
     )
     INSERT INTO gwl_fixture_archive (match_number, fixture, is_result)
     SELECT item->>'number', item, true FROM jsonb_array_elements($2::jsonb) item
     ON CONFLICT (match_number) DO UPDATE SET fixture = EXCLUDED.fixture, is_result = true, last_seen_at = now()`,
    [JSON.stringify(fixtures.upcoming), JSON.stringify(fixtures.recent)],
  );
}

export async function getArchivedGwlResults(): Promise<GwlFixture[]> {
  const rows = await query<{ fixture: unknown }>(
    "SELECT fixture FROM gwl_fixture_archive WHERE is_result ORDER BY fixture->>'startsAt' DESC",
  );
  return rows.map((row) => gwlFixtureSchema.parse(row.fixture));
}

const g = globalThis as unknown as { __gwlArchiveTimer?: NodeJS.Timeout; __gwlArchiveRunning?: boolean };

export function startGwlArchiveScheduler(): void {
  if (process.env.NEXT_PHASE === "phase-production-build" || g.__gwlArchiveTimer) return;
  const run = () => {
    if (g.__gwlArchiveRunning || !env().GWL_API_KEY) return;
    g.__gwlArchiveRunning = true;
    void getGwlFixtures()
      .then(async (snapshot) => {
        if (snapshot.stale) throw new Error(snapshot.error ?? "GWL fixture data is stale.");
        await archiveGwlFixtures(snapshot.data);
      })
      .catch((error: unknown) => console.error("GWL fixture archive:", error instanceof Error ? error.message : "unknown error"))
      .finally(() => { g.__gwlArchiveRunning = false; });
  };
  g.__gwlArchiveTimer = setInterval(run, 60_000);
  g.__gwlArchiveTimer.unref();
  setTimeout(run, 30_000).unref();
}
