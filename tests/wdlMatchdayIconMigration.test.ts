import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { describe, expect, it } from "vitest";

describe.skipIf(!process.env.TEST_DATABASE_URL)("WDL matchday icon migration with PostgreSQL", () => {
  it("creates an unset icon state for safe initial reconciliation", async () => {
    const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    try {
      const migration = await readFile(resolve(process.cwd(), "migrations", "041_wdl_matchday_icon.sql"), "utf8");
      await client.query(migration.replace("CREATE TABLE wdl_matchday_icon_state", "CREATE TEMP TABLE wdl_matchday_icon_state"));
      const variants = await readFile(resolve(process.cwd(), "migrations", "042_calendar_logo_variants.sql"), "utf8");
      await client.query(variants.replace("ALTER TABLE wdl_matchday_icon_state", "ALTER TABLE pg_temp.wdl_matchday_icon_state"));
      const { rows } = await client.query("SELECT id, current_icon, last_error FROM wdl_matchday_icon_state");
      expect(rows).toEqual([{ id: 1, current_icon: null, last_error: null }]);
      for (const variant of ["default", "matchday", "newyear", "remembrance", "st-patricks", "halloween", "easter", "christmas"]) {
        await client.query("UPDATE wdl_matchday_icon_state SET current_icon = $1 WHERE id = 1", [variant]);
      }
      await expect(client.query("UPDATE wdl_matchday_icon_state SET current_icon = 'unknown' WHERE id = 1")).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.end();
    }
  });
});
