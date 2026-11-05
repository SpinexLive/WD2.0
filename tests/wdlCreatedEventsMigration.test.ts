import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe.skipIf(!process.env.TEST_DATABASE_URL)("WDL event registry migration with PostgreSQL", () => {
  let client: pg.Client;

  beforeEach(async () => {
    client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    const fixtures = await readFile(resolve(process.cwd(), "migrations", "034_wdl_fixtures.sql"), "utf8");
    await client.query(fixtures.replace(/CREATE TABLE/g, "CREATE TEMP TABLE"));
    await client.query("CREATE TEMP TABLE audit_logs (id bigserial PRIMARY KEY, target_id text, target_type text, action text, details jsonb, created_at timestamptz NOT NULL DEFAULT now())");
  });

  afterEach(async () => { await client.end(); });

  it("backfills created IDs and keeps ambiguous or manually linked IDs separate", async () => {
    await client.query(`
      INSERT INTO wdl_fixture_events (fixture_id, fixture, state, scheduled_id, event_id, event_channel_id)
      VALUES ('scheduled', '{}', 'scheduled', 's1', NULL, 'channel'),
             ('posted', '{}', 'posted', 's2', 'p2', 'channel'),
             ('manual', '{}', 'posted', 's3', 'manual-p3', 'channel'),
             ('legacy', '{}', 'posted', NULL, 'legacy-p4', 'channel'),
             ('immediate', '{}', 'posted', NULL, 'p5', 'channel'),
             ('ambiguous', '{}', 'scheduled', 's6', NULL, 'channel')
    `);
    await client.query(`
      INSERT INTO audit_logs (target_id, target_type, action, details, created_at)
      VALUES ('scheduled', 'wdl_fixture', 'wdl.event_created', '{"raidId":"s1","scheduled":true}', now() - interval '2 minutes'),
             ('posted', 'wdl_fixture', 'wdl.event_created', '{"raidId":"s2","scheduled":true}', now() - interval '2 minutes'),
             ('manual', 'wdl_fixture', 'wdl.event_created', '{"raidId":"s3","scheduled":true}', now() - interval '2 minutes'),
             ('manual', 'wdl_fixture', 'wdl.event_linked', '{"eventId":"manual-p3"}', now() - interval '1 minute'),
             ('immediate', 'wdl_fixture', 'wdl.event_created', '{"raidId":"p5","scheduled":false}', now() - interval '2 minutes'),
             ('ambiguous', 'wdl_fixture', 'wdl.event_created', '{"raidId":"s6","scheduled":true}', now() - interval '2 minutes'),
             ('another-fixture', 'wdl_fixture', 'wdl.event_created', '{"raidId":"s6","scheduled":true}', now() - interval '2 minutes')
    `);
    const registry = await readFile(resolve(process.cwd(), "migrations", "036_wdl_created_events.sql"), "utf8");
    await client.query(registry.replace(/CREATE TABLE/g, "CREATE TEMP TABLE"));

    const { rows } = await client.query(
      "SELECT fixture_id, scheduled_id, event_id, event_verified, origin FROM wdl_created_events ORDER BY fixture_id, scheduled_id NULLS FIRST",
    );
    expect(rows).toEqual([
      { fixture_id: "ambiguous", scheduled_id: "s6", event_id: null, event_verified: false, origin: "legacy" },
      { fixture_id: "immediate", scheduled_id: null, event_id: "p5", event_verified: false, origin: "automatic" },
      { fixture_id: "legacy", scheduled_id: null, event_id: "legacy-p4", event_verified: false, origin: "legacy" },
      { fixture_id: "manual", scheduled_id: null, event_id: "manual-p3", event_verified: false, origin: "legacy" },
      { fixture_id: "manual", scheduled_id: "s3", event_id: null, event_verified: false, origin: "automatic" },
      { fixture_id: "posted", scheduled_id: "s2", event_id: "p2", event_verified: false, origin: "automatic" },
      { fixture_id: "scheduled", scheduled_id: "s1", event_id: null, event_verified: false, origin: "automatic" },
    ]);
  });

  it("does not falsely verify or fail the migration when cancelled fixtures share an event ID", async () => {
    await client.query(`
      INSERT INTO wdl_fixture_events (fixture_id, fixture, state, scheduled_id, event_id)
      VALUES ('first', '{}', 'cancelled', 's9', 'shared'),
             ('second', '{}', 'posted', 's10', 'shared');
      INSERT INTO audit_logs (target_id, target_type, action, details)
      VALUES ('first', 'wdl_fixture', 'wdl.event_created', '{"raidId":"s9","scheduled":true}'),
             ('second', 'wdl_fixture', 'wdl.event_created', '{"raidId":"s10","scheduled":true}');
    `);
    const registry = await readFile(resolve(process.cwd(), "migrations", "036_wdl_created_events.sql"), "utf8");
    await client.query(registry.replace(/CREATE TABLE/g, "CREATE TEMP TABLE"));
    const { rows } = await client.query("SELECT scheduled_id, event_id, event_verified, origin FROM wdl_created_events");
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.scheduled_id !== null)).toEqual(expect.arrayContaining([
      { scheduled_id: "s9", event_id: null, event_verified: false, origin: "automatic" },
      { scheduled_id: "s10", event_id: null, event_verified: false, origin: "automatic" },
    ]));
    expect(rows.find((row) => row.event_id === "shared")).toMatchObject({ event_verified: false, origin: "legacy" });
  });
});
