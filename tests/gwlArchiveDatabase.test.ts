import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: null as import("pg").Client | null }));
vi.mock("@/lib/db", () => ({
  query: async (sql: string, values: unknown[] = []) => {
    if (!mocks.client) throw new Error("Test database is not connected");
    return (await mocks.client.query(sql, values)).rows;
  },
}));

import { archiveGwlFixtures, getArchivedGwlResults } from "@/server/services/gwlFixtures";
import { gwlFixtureSchema } from "@/server/services/gwl";

const result = gwlFixtureSchema.parse({
  number: "42", status: "COMPLETED", map: "Map", layer: null,
  startsAt: "2026-11-15T20:00:00Z", region: "EU", sides: [],
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("GWL fixture archive with PostgreSQL", () => {
  beforeEach(async () => {
    mocks.client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await mocks.client.connect();
    const migration = await readFile(resolve(process.cwd(), "migrations", "044_gwl_fixture_archive.sql"), "utf8");
    await mocks.client.query(migration.replace("CREATE TABLE", "CREATE TEMP TABLE"));
  });
  afterEach(async () => { await mocks.client?.end(); mocks.client = null; });

  it("retains results outside the recent feed and hides rescheduled results", async () => {
    await archiveGwlFixtures({ upcoming: [], recent: [result] });
    await archiveGwlFixtures({ upcoming: [], recent: [] });
    expect(await getArchivedGwlResults()).toEqual([result]);
    await archiveGwlFixtures({ upcoming: [{ ...result, status: "SCHEDULED" }], recent: [] });
    expect(await getArchivedGwlResults()).toEqual([]);
    await archiveGwlFixtures({ upcoming: [], recent: [result] });
    expect(await getArchivedGwlResults()).toEqual([result]);
  });
});
