import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { describe, expect, it } from "vitest";

describe.skipIf(!process.env.TEST_DATABASE_URL)("attendance removal migration with PostgreSQL", () => {
  it("removes attendance tables and preserves roster responses", async () => {
    const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    try {
      const original = await readFile(resolve(process.cwd(), "migrations", "017_attendance.sql"), "utf8");
      await client.query(original.replace(/CREATE TABLE/g, "CREATE TEMP TABLE"));
      await client.query("CREATE TEMP TABLE roster_responses (discord_id text, response text)");
      await client.query(`
        INSERT INTO attendance_events (event_id, title, starts_at, rostered, in_voice)
        VALUES ('event', 'Event', now(), 1, 1);
        INSERT INTO attendance (event_id, discord_id, display_name, present)
        VALUES ('event', 'player', 'Player', true);
        INSERT INTO roster_responses VALUES ('player', 'accepted');
      `);
      await client.query(await readFile(resolve(process.cwd(), "migrations", "040_remove_attendance.sql"), "utf8"));
      const { rows } = await client.query(`
        SELECT to_regclass('pg_temp.attendance') AS attendance,
               to_regclass('pg_temp.attendance_events') AS attendance_events
      `);
      expect(rows[0]).toEqual({ attendance: null, attendance_events: null });
      expect((await client.query("SELECT * FROM roster_responses")).rows).toEqual([{ discord_id: "player", response: "accepted" }]);
    } finally {
      await client.end();
    }
  });
});
