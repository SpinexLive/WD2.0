import { independentQuery as query, tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { HttpError, ProviderError } from "@/lib/http";
import { FACTIONS, resolveFaction } from "@/lib/scouting";
import type { Session } from "@/lib/session";
import { parseWdlMap, wdlFixtureSchema, type WdlFixture, type WdlFixtures } from "@/lib/wdlFixtures";
import { deleteMessage, editMessage, postMessage, type DiscordMessagePayload } from "./discord";
import { getLeagueFixtures } from "./wardogsLeague";

export const WDL_RESULTS_CHANNEL = "1568220944609316896";
const WDL_RESULT_STYLE_VERSION = 2;
const WDL_RESULTS_LOCK = 824035;
const actor = { discordId: "system:wdl", displayName: "WDL results worker" };
const safe = (value: string | null | undefined, fallback: string) =>
  (value?.trim().replace(/[\r\n]/g, " ").replace(/([\\*_`~|>])/g, "\\$1") || fallback).slice(0, 100);

export function wdlResultPayload(fixture: WdlFixture): DiscordMessagePayload {
  const completed = fixture.status.toUpperCase() === "COMPLETED";
  const location = parseWdlMap(fixture.map);
  const sorted = [...fixture.participants].sort((a, b) => (a.finishingPosition ?? Infinity) - (b.finishingPosition ?? Infinity));
  const lines = sorted.map((participant) => {
    const faction = resolveFaction(participant.faction);
    const emoji = faction ? `<:${faction}:${FACTIONS[faction].emojiId}> ` : "";
    const points = participant.points === null ? "Points TBC" : `${participant.points} points`;
    return `${emoji}**${safe(participant.team.code || participant.team.name, "Team TBC")}** · ${points}${participant.noShow ? " · No show" : ""}`;
  });
  const description = completed
    ? [`**Map:** ${safe(location.map, "TBC")}`, `**Zone:** ${safe(location.zone, "TBC")}`,
      `**Weather:** ${safe(location.weather, "TBC")}`, "", ...lines].join("\n")
    : "This fixture is no longer marked completed by WDL. The previous result should not be considered final.";
  const title = fixture.participants.map((p) => safe(p.team.code || p.team.name, "Team TBC")).join(" v ");
  const fullDescription = `**${title.slice(0, 250)}**\n\n${description}`;
  if (fullDescription.length > 4096) throw new Error("The WDL result is too large to post safely.");
  const base = env().APP_URL;
  return {
    embeds: [{
      title: `${completed ? "WDL match result" : "WDL result withdrawn"}${fixture.number !== null ? ` #${fixture.number}` : ""}`.slice(0, 256),
      description: fullDescription,
      color: 0x8b1a1a,
      thumbnail: { url: `${base}/images/WDL.webp` },
      ...(fixture.scheduledAt ? { timestamp: fixture.scheduledAt } : {}),
      footer: { text: completed ? "Official WDL result · Points are not in-game scores" : "Status changed in WDL" },
    }],
    components: [],
    allowed_mentions: { parse: [] },
  };
}

function eligible(fixture: WdlFixture) {
  return fixture.status.toUpperCase() === "COMPLETED" &&
    fixture.participants.length >= 2 &&
    fixture.participants.filter((p) => p.team.code?.trim().toUpperCase() === "RMNT").length === 1 &&
    fixture.participants.every((p) => !!(p.team.code?.trim() || p.team.name?.trim())) &&
    new Set(fixture.participants.map((p) => (p.team.code || p.team.name || "").trim().toUpperCase())).size === fixture.participants.length;
}

export async function retryUncertainWdlResult(fixtureId: string, user: Pick<Session, "discordId" | "displayName">) {
  const updated = await query(
    `UPDATE wdl_result_posts SET state = 'pending', error = NULL, updated_at = now()
      WHERE fixture_id = $1 AND state = 'uncertain' AND message_id IS NULL RETURNING fixture_id`, [fixtureId],
  );
  if (!updated.length) throw new HttpError(409, "This result is not awaiting an uncertain-post review.", "wdl_result_not_uncertain");
  await audit(user, "wdl.result_retry_requested", "wdl_fixture", fixtureId);
}

export async function syncWdlResults(fixtures: WdlFixtures) {
  await tx(async (client) => {
    const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_xact_lock($1) AS acquired", [WDL_RESULTS_LOCK]);
    if (!lock.rows[0]?.acquired) return;
    await syncWdlResultsLocked(fixtures);
  });
}

async function syncWdlResultsLocked(fixtures: WdlFixtures) {
  if (env().DISCORD_GUILD_ID !== "1332320879073296404") throw new Error("WDL result channel is configured for a different Discord guild.");
  await reorderExistingResults(fixtures);
  await query(
    `UPDATE wdl_result_posts SET state = 'uncertain', error = 'Discord posting was interrupted; check the results channel before retrying.', updated_at = now()
      WHERE state = 'posting' AND updated_at < now() - interval '5 minutes'`,
  );
  await query(
    `UPDATE wdl_result_posts SET state = 'posted', error = 'An interrupted edit will be retried.', updated_at = now()
      WHERE state = 'updating' AND updated_at < now() - interval '5 minutes'`,
  );
  for (const fixture of [...fixtures.upcoming, ...fixtures.recent]) {
    if (eligible(fixture)) {
      await query(
        `INSERT INTO wdl_result_posts (fixture_id, fixture, state) VALUES ($1, $2, 'pending')
         ON CONFLICT (fixture_id) DO UPDATE SET fixture = EXCLUDED.fixture,
           state = CASE WHEN wdl_result_posts.state = 'review' THEN CASE WHEN wdl_result_posts.message_id IS NULL THEN 'pending' ELSE 'posted' END ELSE wdl_result_posts.state END,
           error = CASE WHEN wdl_result_posts.state = 'review' THEN NULL ELSE wdl_result_posts.error END`,
        [fixture.id, JSON.stringify(fixture)],
      );
    } else if (fixture.status.toUpperCase() === "COMPLETED") {
      await query(
        `INSERT INTO wdl_result_posts (fixture_id, fixture, state, error)
         VALUES ($1, $2, 'review', 'WDL returned an incomplete or ambiguous team list; this result needs review.')
         ON CONFLICT (fixture_id) DO UPDATE SET fixture = EXCLUDED.fixture,
           state = CASE WHEN wdl_result_posts.state IN ('pending', 'posted', 'review') THEN 'review' ELSE wdl_result_posts.state END,
           error = CASE WHEN wdl_result_posts.state IN ('pending', 'posted', 'review') THEN EXCLUDED.error ELSE wdl_result_posts.error END`,
        [fixture.id, JSON.stringify(fixture)],
      );
    } else {
      await query(
        `UPDATE wdl_result_posts SET fixture = $2,
          state = CASE WHEN state = 'review' THEN CASE WHEN message_id IS NULL THEN 'pending' ELSE 'posted' END ELSE state END,
          error = CASE WHEN state = 'review' THEN NULL ELSE error END WHERE fixture_id = $1`,
        [fixture.id, JSON.stringify(fixture)],
      );
    }
  }
  const observedIds = [...fixtures.upcoming, ...fixtures.recent].map((fixture) => fixture.id);
  for (let i = 0; i < 10; i++) {
    const [row] = await query<{ fixture_id: string; fixture: unknown; state: "posting" | "updating"; message_id: string | null }>(
      `UPDATE wdl_result_posts SET state = CASE WHEN state = 'pending' THEN 'posting' ELSE 'updating' END,
          error = NULL, updated_at = now()
       WHERE fixture_id = (
         SELECT fixture_id FROM wdl_result_posts
          WHERE (state = 'pending' AND fixture_id = ANY($1::text[]) AND upper(fixture->>'status') = 'COMPLETED')
             OR (state = 'posted' AND ((fixture_id = ANY($1::text[]) AND fixture IS DISTINCT FROM published_fixture)
                 OR (published_style_version < $2 AND published_fixture IS NOT NULL)))
          ORDER BY CASE WHEN state = 'pending' THEN 0 ELSE 1 END,
            CASE WHEN state = 'pending' THEN (fixture->>'scheduledAt')::timestamptz END ASC NULLS LAST,
            fixture_id FOR UPDATE SKIP LOCKED LIMIT 1
       ) RETURNING fixture_id, CASE WHEN fixture_id = ANY($1::text[]) THEN fixture ELSE published_fixture END AS fixture, state, message_id`,
      [observedIds, WDL_RESULT_STYLE_VERSION],
    );
    if (!row) break;
    let writing = false;
    try {
      const fixture = wdlFixtureSchema.parse(row.fixture);
      if (fixture.status.toUpperCase() === "COMPLETED" && !eligible(fixture)) throw new Error("The completed fixture lacks enough reliable team information to post.");
      const payload = wdlResultPayload(fixture);
      writing = true;
      if (row.state === "posting") {
        const messageId = await postMessage(WDL_RESULTS_CHANNEL, payload);
        if (!/^\d{15,22}$/.test(messageId)) throw new Error("Discord returned an invalid result message ID.");
        try {
          const saved = await query(
            "UPDATE wdl_result_posts SET state = 'posted', message_id = $2, published_fixture = $3, published_style_version = $4, error = NULL, updated_at = now() WHERE fixture_id = $1 AND state = 'posting' RETURNING fixture_id",
            [row.fixture_id, messageId, JSON.stringify(fixture), WDL_RESULT_STYLE_VERSION],
          );
          if (!saved.length) throw new Error("The result changed state before its message ID was recorded.");
        } catch (error) {
          console.error("WDL result was posted but its message ID could not be recorded:", { fixtureId: row.fixture_id, messageId, channelId: WDL_RESULTS_CHANNEL });
          throw error;
        }
        await audit(actor, "wdl.result_posted", "wdl_fixture", row.fixture_id, { messageId, channelId: WDL_RESULTS_CHANNEL });
      } else {
        if (!row.message_id) throw new Error("The result has no Discord message ID.");
        await editMessage(WDL_RESULTS_CHANNEL, row.message_id, payload);
        const saved = await query(
          "UPDATE wdl_result_posts SET state = 'posted', published_fixture = $2, published_style_version = $3, error = NULL, updated_at = now() WHERE fixture_id = $1 AND state = 'updating' RETURNING fixture_id",
          [row.fixture_id, JSON.stringify(fixture), WDL_RESULT_STYLE_VERSION],
        );
        if (!saved.length) throw new Error("The result changed state before its edit could be recorded.");
        await audit(actor, "wdl.result_updated", "wdl_fixture", row.fixture_id, { messageId: row.message_id, channelId: WDL_RESULTS_CHANNEL });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Discord result posting error";
      const rejected = error instanceof ProviderError && error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 408;
      const state = row.state === "updating" ? "posted" : !writing || rejected ? "pending" : "uncertain";
      await query("UPDATE wdl_result_posts SET state = $2, error = $3, updated_at = now() WHERE fixture_id = $1 AND state = $4",
        [row.fixture_id, state, message.slice(0, 500), row.state]);
      throw new Error(`WDL result ${row.fixture_id} could not be ${row.state === "posting" ? "posted" : "updated"}: ${message}`);
    }
  }
}

async function reorderExistingResults(fixtures: WdlFixtures) {
  const rows = await query<{ message_id: string; fixture_id: string | null; deleted: boolean; state: string | null; current_message_id: string | null }>(
    `SELECT reorder.message_id, reorder.fixture_id, reorder.deleted, posts.state, posts.message_id AS current_message_id
       FROM wdl_result_reorder AS reorder LEFT JOIN wdl_result_posts AS posts ON posts.fixture_id = reorder.fixture_id
      WHERE NOT reorder.completed ORDER BY reorder.message_id`,
  );
  if (!rows.length) return;
  const current = new Map(fixtures.recent.map((fixture) => [fixture.id, fixture]));
  if (rows.length !== 6 || rows.some((row) => !row.fixture_id || row.state !== "posted" || row.current_message_id !== row.message_id ||
      !current.has(row.fixture_id) || !eligible(current.get(row.fixture_id)!))) {
    throw new Error("The six existing result messages cannot all be verified against current completed WDL fixtures; no further reorder actions will run. Review the result channel and server logs.");
  }
  for (const row of rows) wdlResultPayload(current.get(row.fixture_id!)!);
  for (const row of rows) {
    if (row.deleted) continue;
    await deleteMessage(WDL_RESULTS_CHANNEL, row.message_id);
    await query("UPDATE wdl_result_reorder SET deleted = true WHERE message_id = $1 AND NOT completed", [row.message_id]);
    await audit(actor, "wdl.result_reorder_deleted", "wdl_fixture", row.fixture_id!, { messageId: row.message_id, channelId: WDL_RESULTS_CHANNEL });
  }
  const reset = await query<{ count: string }>(
    `WITH reset AS (
       UPDATE wdl_result_posts AS posts
          SET state = 'pending', message_id = NULL, published_fixture = NULL, error = NULL, updated_at = now()
         FROM wdl_result_reorder AS reorder
        WHERE NOT reorder.completed AND reorder.deleted AND posts.fixture_id = reorder.fixture_id
          AND posts.state = 'posted' AND posts.message_id = reorder.message_id
          AND (SELECT count(*) FROM wdl_result_reorder AS pending
               JOIN wdl_result_posts AS linked ON linked.fixture_id = pending.fixture_id
              WHERE NOT pending.completed AND pending.deleted
                AND linked.state = 'posted' AND linked.message_id = pending.message_id) = $1
        RETURNING posts.fixture_id
     ), finished AS (
       UPDATE wdl_result_reorder AS reorder SET completed = true
        FROM reset WHERE reorder.fixture_id = reset.fixture_id AND NOT reorder.completed
        RETURNING reorder.fixture_id
     ) SELECT count(*)::text AS count FROM finished`, [rows.length],
  );
  if (Number(reset[0]?.count) !== rows.length) throw new Error("Could not queue all reordered WDL results. Check Admin and server logs before retrying.");
}

export async function wdlResultTick() {
  const snapshot = await getLeagueFixtures();
  if (snapshot.stale) throw new Error(snapshot.error ?? "Wardogs League fixtures are stale.");
  await syncWdlResults(snapshot.data);
}

const g = globalThis as unknown as { __wdlResultsTimer?: NodeJS.Timeout };
export function startWdlResultsScheduler() {
  if (process.env.NEXT_PHASE === "phase-production-build" || g.__wdlResultsTimer) return;
  const run = () => void wdlResultTick().then(
    () => query("UPDATE wdl_result_post_status SET last_error = NULL, last_checked_at = now() WHERE id = 1"),
    (error: Error) => {
      console.error("WDL results:", error.message);
      return query("UPDATE wdl_result_post_status SET last_error = $1, last_checked_at = now() WHERE id = 1", [error.message.slice(0, 500)]);
    },
  ).catch((error: Error) => console.error("Could not record WDL result status:", error.message));
  g.__wdlResultsTimer = setInterval(run, 60_000);
  g.__wdlResultsTimer.unref();
  setTimeout(run, 35_000).unref();
}
