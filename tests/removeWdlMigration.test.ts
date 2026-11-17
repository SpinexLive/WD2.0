import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { describe, expect, it } from "vitest";

describe.skipIf(!process.env.TEST_DATABASE_URL)("WDL removal migration", () => {
  it("removes WDL data while preserving GWL, other roster settings and the calendar icon", async () => {
    const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query("CREATE TEMP TABLE rosters (settings jsonb NOT NULL DEFAULT '{\"warnUnregistered\":true}')");
      await client.query("INSERT INTO rosters VALUES ('{\"warnUnregistered\":false,\"other\":1}')");
      await client.query("CREATE TEMP TABLE audit_logs (action text, target_type text)");
      await client.query("INSERT INTO audit_logs VALUES ('wdl.event_created', 'wdl_fixture'), ('application.accept', 'application'), ('gwl.application_accept', 'gwl_application')");
      const icon = await readFile(resolve(process.cwd(), "migrations", "041_wdl_matchday_icon.sql"), "utf8");
      const variants = await readFile(resolve(process.cwd(), "migrations", "042_calendar_logo_variants.sql"), "utf8");
      await client.query(icon.replace("CREATE TABLE", "CREATE TEMP TABLE"));
      await client.query(variants);
      await client.query("UPDATE wdl_matchday_icon_state SET current_icon = 'christmas'");
      for (const table of ["wdl_result_reorder", "wdl_result_post_status", "wdl_result_posts", "wdl_created_events",
        "wdl_raid_tests", "wdl_fixture_events", "wdl_raid_settings", "wdl_fixture_archive", "wdl_role_settings"]) {
        await client.query(`CREATE TEMP TABLE ${table} (id integer)`);
      }
      await client.query("CREATE TEMP TABLE gwl_raid_events (id integer)");
      await client.query("INSERT INTO gwl_raid_events VALUES (42)");
      await client.query(await readFile(resolve(process.cwd(), "migrations", "048_remove_wdl.sql"), "utf8"));
      expect((await client.query("SELECT settings FROM rosters")).rows[0].settings).toEqual({ other: 1 });
      expect((await client.query("SELECT action FROM audit_logs")).rows).toEqual([{ action: "gwl.application_accept" }]);
      expect((await client.query("SELECT current_icon FROM calendar_icon_state")).rows[0].current_icon).toBe("christmas");
      expect((await client.query("SELECT id FROM gwl_raid_events")).rows).toEqual([{ id: 42 }]);
      expect((await client.query("SELECT to_regclass('pg_temp.wdl_fixture_events') AS name")).rows[0].name).toBeNull();
    } finally {
      await client.end();
    }
  });
});
