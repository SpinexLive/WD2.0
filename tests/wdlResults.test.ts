import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: null as import("pg").Client | null,
  post: vi.fn(), edit: vi.fn(), remove: vi.fn(), fixtures: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  independentQuery: async (sql: string, values: unknown[] = []) => {
    if (!mocks.client) throw new Error("Test database is not connected");
    return (await mocks.client.query(sql, values)).rows;
  },
  tx: async (fn: (client: import("pg").Client) => Promise<void>) => {
    const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query("BEGIN");
      await fn(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      await client.end();
    }
  },
}));
vi.mock("@/lib/env", () => ({ env: () => ({ DISCORD_GUILD_ID: "1332320879073296404", APP_URL: "https://dashboard.test" }) }));
vi.mock("@/server/services/discord", () => ({ postMessage: mocks.post, editMessage: mocks.edit, deleteMessage: mocks.remove }));
vi.mock("@/server/services/wardogsLeague", () => ({ getLeagueFixtures: mocks.fixtures }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import { ProviderError } from "@/lib/http";
import type { WdlFixture, WdlFixtures } from "@/lib/wdlFixtures";
import { retryUncertainWdlResult, syncWdlResults, wdlResultPayload, wdlResultTick, WDL_RESULTS_CHANNEL } from "@/server/services/wdlResults";

const result: WdlFixture = {
  id: "fixture", number: 42, status: "COMPLETED", scheduledAt: "2026-11-08T19:00:00.000Z",
  map: "Ozeti · Default · DayEarlyFog", gameMode: "Hidden", competition: null,
  participants: [
    { team: { code: "RMNT", name: "Remnant" }, faction: "MANTICORE", finishingPosition: 2, points: 2, noShow: false },
    { team: { code: "HTD", name: "HaiiTeD" }, faction: "VALKYRA", finishingPosition: 1, points: 3, noShow: false },
    { team: { code: "OKT", name: "Oktogon" }, faction: "LONESTAR", finishingPosition: null, points: null, noShow: true },
  ],
};
const snapshot = (recent: WdlFixture[], upcoming: WdlFixture[] = []): WdlFixtures => ({ recent, upcoming });

describe("WDL result presentation", () => {
  it("shows points, faction emojis and the logo without positions or buttons", () => {
    const payload = wdlResultPayload(result);
    const embed = payload.embeds[0] as { title: string; description: string; thumbnail: { url: string }; footer: { text: string } };
    expect(embed.title).toBe("WDL match result #42");
    expect(embed.description).toContain("**Map:** Ozeti\n**Zone:** Default\n**Weather:** DayEarlyFog");
    expect(embed.description).toContain("<:valkyra:1564588959542157382> **HTD** · 3 points");
    expect(embed.description).toContain("<:manticore:1564588916110270504> **RMNT** · 2 points");
    expect(embed.description).toContain("<:lonestar:1564588882551636058> **OKT** · Points TBC · No show");
    expect(embed.description.lastIndexOf("**HTD**")).toBeLessThan(embed.description.lastIndexOf("**RMNT**"));
    expect(embed.description).not.toContain("Position");
    expect(embed.description).not.toContain("Hidden");
    expect(embed.thumbnail.url).toBe("https://dashboard.test/images/WDL.webp");
    expect(embed.footer.text).toContain("not in-game scores");
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.components).toEqual([]);
  });

  it("labels a result withdrawn if WDL moves the fixture back to scheduled", () => {
    const payload = wdlResultPayload({ ...result, status: "SCHEDULED" });
    const embed = payload.embeds[0] as { title: string; description: string };
    expect(embed.title).toContain("withdrawn");
    expect(embed.description).toContain("no longer marked completed");
    expect(embed.description).not.toContain("3 points");
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("WDL result posting with PostgreSQL", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await mocks.client.connect();
    const migration = await readFile(resolve(process.cwd(), "migrations", "037_wdl_result_posts.sql"), "utf8");
    await mocks.client.query(migration.replace(/CREATE TABLE/g, "CREATE TEMP TABLE"));
    const styleMigration = await readFile(resolve(process.cwd(), "migrations", "038_wdl_result_style.sql"), "utf8");
    await mocks.client.query(styleMigration);
    const reorderMigration = await readFile(resolve(process.cwd(), "migrations", "039_reorder_existing_wdl_results.sql"), "utf8");
    await mocks.client.query(reorderMigration.replace(/CREATE TABLE/g, "CREATE TEMP TABLE"));
    mocks.post.mockResolvedValue("1568220944609316900");
    mocks.edit.mockResolvedValue(undefined);
    mocks.remove.mockResolvedValue(undefined);
    mocks.audit.mockResolvedValue(undefined);
  });
  afterEach(async () => { await mocks.client?.end(); mocks.client = null; });

  it("posts existing recent completed fixtures once and never posts scheduled fixtures", async () => {
    await syncWdlResults(snapshot([result], [{ ...result, id: "scheduled", status: "SCHEDULED" }]));
    await syncWdlResults(snapshot([result], [{ ...result, id: "scheduled", status: "SCHEDULED" }]));
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(mocks.post).toHaveBeenCalledWith(WDL_RESULTS_CHANNEL, wdlResultPayload(result));
    expect(mocks.edit).not.toHaveBeenCalled();
    const rows = (await mocks.client!.query("SELECT fixture_id, state, message_id FROM wdl_result_posts")).rows;
    expect(rows).toEqual([{ fixture_id: "fixture", state: "posted", message_id: "1568220944609316900" }]);
  });

  it("posts oldest dated matches first, with undated matches last", async () => {
    let id = 100000000000000000n;
    mocks.post.mockImplementation(async () => String(id++));
    const newest = { ...result, id: "newest", scheduledAt: "2026-11-08T19:00:00.000Z" };
    const oldest = { ...result, id: "oldest", scheduledAt: "2025-01-08T19:00:00.000Z" };
    const undated = { ...result, id: "undated", scheduledAt: null };
    const middle = { ...result, id: "middle", scheduledAt: "2026-02-08T19:00:00.000Z" };
    await syncWdlResults(snapshot([newest, undated, middle, oldest]));
    expect(mocks.post.mock.calls.map((call) => call[1])).toEqual([
      wdlResultPayload(oldest), wdlResultPayload(middle), wdlResultPayload(newest), wdlResultPayload(undated),
    ]);
  });

  it("updates old-style messages even when absent from the current WDL feed", async () => {
    await mocks.client!.query(
      "INSERT INTO wdl_result_posts (fixture_id, fixture, published_fixture, state, message_id, published_style_version) VALUES ($1, $2, $2, 'posted', $3, 1)",
      [result.id, JSON.stringify(result), "1568220944609316900"],
    );
    await syncWdlResults(snapshot([]));
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.edit).toHaveBeenCalledWith(WDL_RESULTS_CHANNEL, "1568220944609316900", wdlResultPayload(result));
    expect((await mocks.client!.query("SELECT published_style_version FROM wdl_result_posts")).rows[0].published_style_version).toBe(2);
    await syncWdlResults(snapshot([]));
    expect(mocks.edit).toHaveBeenCalledOnce();
  });

  it("deletes only the six confirmed messages and reposts oldest first", async () => {
    const ids = ["1568223527222513665", "1568223528237535285", "1568223529500151914", "1568223531114692610", "1568223532851142808", "1568223534256488499"];
    const results = ids.map((messageId, index) => ({ ...result, id: `result-${index}`, scheduledAt: `2026-01-0${6 - index}T19:00:00.000Z`, messageId }));
    for (const fixture of results) {
      await mocks.client!.query("INSERT INTO wdl_result_posts (fixture_id, fixture, published_fixture, state, message_id) VALUES ($1, $2, $2, 'posted', $3)", [fixture.id, JSON.stringify(fixture), fixture.messageId]);
    }
    await mocks.client!.query("DROP TABLE wdl_result_reorder");
    const migration = await readFile(resolve(process.cwd(), "migrations", "039_reorder_existing_wdl_results.sql"), "utf8");
    await mocks.client!.query(migration.replace(/CREATE TABLE/g, "CREATE TEMP TABLE"));
    let id = 100000000000000000n;
    mocks.post.mockImplementation(async () => String(id++));
    await syncWdlResults(snapshot(results));
    expect(mocks.remove.mock.calls.map((call) => call[1])).toEqual(ids);
    expect(mocks.post.mock.calls.map((call) => call[1])).toEqual([...results].reverse().map(wdlResultPayload));
    expect((await mocks.client!.query("SELECT count(*)::int AS n FROM wdl_result_reorder WHERE completed")).rows[0].n).toBe(6);
    await syncWdlResults(snapshot(results));
    expect(mocks.remove).toHaveBeenCalledTimes(6);
    expect(mocks.post).toHaveBeenCalledTimes(6);
  });

  it("does not delete any existing results when the confirmed set cannot be verified", async () => {
    await mocks.client!.query("INSERT INTO wdl_result_reorder (message_id, fixture_id) VALUES ('1568223527222513665', NULL)");
    await expect(syncWdlResults(snapshot([result]))).rejects.toThrow("cannot all be verified");
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("resumes a partially completed reorder without deleting completed entries twice", async () => {
    const ids = ["1568223527222513665", "1568223528237535285", "1568223529500151914", "1568223531114692610", "1568223532851142808", "1568223534256488499"];
    const results = ids.map((messageId, index) => ({ ...result, id: `result-${index}`, messageId }));
    for (const fixture of results) {
      await mocks.client!.query("INSERT INTO wdl_result_posts (fixture_id, fixture, published_fixture, state, message_id) VALUES ($1, $2, $2, 'posted', $3)", [fixture.id, JSON.stringify(fixture), fixture.messageId]);
      await mocks.client!.query("INSERT INTO wdl_result_reorder (message_id, fixture_id) VALUES ($1, $2)", [fixture.messageId, fixture.id]);
    }
    mocks.remove.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Discord unavailable"));
    await expect(syncWdlResults(snapshot(results))).rejects.toThrow("Discord unavailable");
    expect(mocks.post).not.toHaveBeenCalled();
    expect((await mocks.client!.query("SELECT count(*)::int AS n FROM wdl_result_reorder WHERE deleted")).rows[0].n).toBe(1);
    let id = 100000000000000000n;
    mocks.post.mockImplementation(async () => String(id++));
    await syncWdlResults(snapshot(results));
    expect(mocks.remove.mock.calls.filter((call) => call[1] === ids[0])).toHaveLength(1);
    expect(mocks.post).toHaveBeenCalledTimes(6);
  });

  it("updates the original message when results change and withdraws a reversed result", async () => {
    await syncWdlResults(snapshot([result]));
    const revised = { ...result, participants: result.participants.map((p) => p.team.code === "RMNT" ? { ...p, points: 5 } : p) };
    await syncWdlResults(snapshot([revised]));
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(mocks.edit).toHaveBeenCalledWith(WDL_RESULTS_CHANNEL, "1568220944609316900", wdlResultPayload(revised));
    const reversed = { ...revised, status: "SCHEDULED" };
    await syncWdlResults(snapshot([], [reversed]));
    expect(mocks.edit).toHaveBeenCalledWith(WDL_RESULTS_CHANNEL, "1568220944609316900", wdlResultPayload(reversed));
    await syncWdlResults(snapshot([], [reversed]));
    expect(mocks.edit).toHaveBeenCalledTimes(2);
  });

  it("retains a newer fixture seen while the previous Discord edit is in progress", async () => {
    await syncWdlResults(snapshot([result]));
    const revised = { ...result, map: "Another map" };
    const newer = { ...result, map: "Newest map" };
    mocks.edit.mockImplementationOnce(async () => {
      await mocks.client!.query("UPDATE wdl_result_posts SET fixture = $2 WHERE fixture_id = $1", [result.id, JSON.stringify(newer)]);
    });
    await syncWdlResults(snapshot([revised]));
    const row = (await mocks.client!.query("SELECT fixture, published_fixture FROM wdl_result_posts")).rows[0];
    expect(row.fixture.map).toBe("Newest map");
    expect(row.published_fixture.map).toBe("Newest map");
    expect(mocks.edit).toHaveBeenCalledTimes(2);
    expect(mocks.edit).toHaveBeenLastCalledWith(WDL_RESULTS_CHANNEL, "1568220944609316900", wdlResultPayload(newer));
  });

  it("locks uncertain deliveries and never repeats the POST automatically", async () => {
    mocks.post.mockRejectedValueOnce(new ProviderError("discord", "timeout", undefined, true));
    await expect(syncWdlResults(snapshot([result]))).rejects.toThrow("could not be posted");
    expect((await mocks.client!.query("SELECT state FROM wdl_result_posts")).rows[0].state).toBe("uncertain");
    await syncWdlResults(snapshot([result]));
    expect(mocks.post).toHaveBeenCalledOnce();
    const owner = { discordId: "owner", displayName: "Owner" };
    await retryUncertainWdlResult(result.id, owner);
    expect(mocks.audit).toHaveBeenCalledWith(owner, "wdl.result_retry_requested", "wdl_fixture", result.id);
    await syncWdlResults(snapshot([result]));
    expect(mocks.post).toHaveBeenCalledTimes(2);
    await expect(retryUncertainWdlResult(result.id, owner)).rejects.toMatchObject({ code: "wdl_result_not_uncertain" });
  });

  it("retries definite Discord rejections without creating an uncertain record", async () => {
    mocks.post.mockRejectedValueOnce(new ProviderError("discord", "permissions", 403));
    await expect(syncWdlResults(snapshot([result]))).rejects.toThrow("permissions");
    expect((await mocks.client!.query("SELECT state FROM wdl_result_posts")).rows[0].state).toBe("pending");
    await syncWdlResults(snapshot([result]));
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it("does not duplicate posts when workers overlap", async () => {
    let release!: () => void;
    let started!: () => void;
    const posting = new Promise<void>((resolve) => { started = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    mocks.post.mockImplementationOnce(async () => { started(); await wait; return "1568220944609316900"; });
    const first = syncWdlResults(snapshot([result]));
    await posting;
    await syncWdlResults(snapshot([result]));
    release();
    await first;
    expect(mocks.post).toHaveBeenCalledOnce();
  });

  it("recovers interrupted posting as uncertain", async () => {
    await mocks.client!.query("INSERT INTO wdl_result_posts (fixture_id, fixture, state, updated_at) VALUES ($1, $2, 'posting', now() - interval '6 minutes')", [result.id, JSON.stringify(result)]);
    await syncWdlResults(snapshot([result]));
    expect((await mocks.client!.query("SELECT state FROM wdl_result_posts")).rows[0].state).toBe("uncertain");
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("retries a failed or interrupted edit against the same message", async () => {
    await syncWdlResults(snapshot([result]));
    const revised = { ...result, map: "New map" };
    mocks.edit.mockRejectedValueOnce(new Error("network error"));
    await expect(syncWdlResults(snapshot([revised]))).rejects.toThrow("could not be updated");
    expect((await mocks.client!.query("SELECT state FROM wdl_result_posts")).rows[0].state).toBe("posted");
    await syncWdlResults(snapshot([revised]));
    expect(mocks.edit).toHaveBeenCalledTimes(2);
    await mocks.client!.query("UPDATE wdl_result_posts SET state = 'updating', published_fixture = $1, updated_at = now() - interval '6 minutes'", [JSON.stringify(result)]);
    await syncWdlResults(snapshot([revised]));
    expect(mocks.edit).toHaveBeenCalledTimes(3);
    expect(mocks.post).toHaveBeenCalledOnce();
  });

  it("does not deliver stale snapshots, absent pending fixtures, or incomplete identities", async () => {
    mocks.fixtures.mockResolvedValue({ stale: true, error: "WDL offline", data: snapshot([result]) });
    await expect(wdlResultTick()).rejects.toThrow("WDL offline");
    await mocks.client!.query("INSERT INTO wdl_result_posts (fixture_id, fixture, state) VALUES ($1, $2, 'pending')", [result.id, JSON.stringify(result)]);
    await syncWdlResults(snapshot([{ ...result, id: "other", participants: [] }]));
    expect(mocks.post).not.toHaveBeenCalled();
    expect((await mocks.client!.query("SELECT state FROM wdl_result_posts WHERE fixture_id = 'other'")).rows[0].state).toBe("review");
    await syncWdlResults(snapshot([{ ...result, id: "other" }]));
    expect(mocks.post).toHaveBeenCalledOnce();
  });
});
