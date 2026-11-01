import { query, tx } from "@/lib/db";
import { ProviderError } from "@/lib/http";
import { getMatches, getMatchPlayers } from "@/server/services/wardogsRcon";

// The API allows 120 requests a minute per key, shared with links and stats lookups, so the sync keeps well under that.
const GAP_MS = 750;
const MAX_MATCHES_PER_RUN = 50;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SyncState { running: Promise<void> | null; lastRunAt: number; pending: number; lastError: string | null; incomplete: boolean; failed: boolean }
const g = globalThis as unknown as { __matchSync?: SyncState };
const state = (): SyncState => (g.__matchSync ??= { running: null, lastRunAt: 0, pending: 0, lastError: null, incomplete: false, failed: false });

type MatchSummary = Awaited<ReturnType<typeof getMatches>>["data"][number];

async function enqueueMatches(matches: MatchSummary[]) {
  const completed = matches.filter((match) => match.endedAt !== null);
  if (!completed.length) return;
  await query(
    `INSERT INTO match_sync_queue (id, server_name, map, started_at, ended_at, duration_s, peak_players, mvp_steam_id)
     SELECT m.id, m."serverName", m.map, m."startedAt", m."endedAt", m."durationS", m."peakPlayers", m."mvpSteamId"
       FROM jsonb_to_recordset($1::jsonb) AS m(
         id bigint, "serverName" text, map text, "startedAt" timestamptz, "endedAt" timestamptz,
         "durationS" integer, "peakPlayers" integer, "mvpSteamId" text
       )
      WHERE NOT EXISTS (SELECT 1 FROM matches WHERE id = m.id)
     ON CONFLICT (id) DO UPDATE SET
       server_name = EXCLUDED.server_name, map = EXCLUDED.map, started_at = EXCLUDED.started_at,
       ended_at = EXCLUDED.ended_at, duration_s = EXCLUDED.duration_s,
       peak_players = EXCLUDED.peak_players, mvp_steam_id = EXCLUDED.mvp_steam_id`,
    [JSON.stringify(completed)],
  );
}

interface QueuedMatch {
  id: string;
  server_name: string | null;
  map: string | null;
  started_at: Date | null;
  ended_at: Date;
  duration_s: number | null;
  peak_players: number | null;
  mvp_steam_id: string | null;
  stored: boolean;
}

async function processQueuedMatch(): Promise<"empty" | "processed" | "failed" | "provider-unavailable"> {
  return tx(async (c) => {
    const result = await c.query<QueuedMatch>(
      `SELECT q.id, q.server_name, q.map, q.started_at, q.ended_at, q.duration_s, q.peak_players, q.mvp_steam_id,
              EXISTS (SELECT 1 FROM matches m WHERE m.id = q.id) AS stored
         FROM match_sync_queue q
        WHERE q.next_attempt_at <= now()
        ORDER BY q.ended_at, q.id
        LIMIT 1 FOR UPDATE OF q SKIP LOCKED`,
    );
    const match = result.rows[0];
    if (!match) return "empty";
    if (match.stored) {
      await c.query("DELETE FROM match_sync_queue WHERE id = $1", [match.id]);
      return "processed";
    }

    let players: Awaited<ReturnType<typeof getMatchPlayers>>;
    try {
      players = await getMatchPlayers(Number(match.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown match detail error";
      await c.query(
        `UPDATE match_sync_queue
            SET attempts = attempts + 1, next_attempt_at = now() + interval '1 minute', last_error = $2
          WHERE id = $1`,
        [match.id, message.slice(0, 500)],
      );
      return error instanceof ProviderError && (error.retryable || error.status === 401 || error.status === 403)
        ? "provider-unavailable"
        : "failed";
    }

    await c.query(
      `INSERT INTO matches (id, server_name, map, started_at, ended_at, duration_s, peak_players, mvp_steam_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET server_name = EXCLUDED.server_name, map = EXCLUDED.map, started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at,
         duration_s = EXCLUDED.duration_s, peak_players = EXCLUDED.peak_players, mvp_steam_id = EXCLUDED.mvp_steam_id, synced_at = now()`,
      [match.id, match.server_name, match.map, match.started_at, match.ended_at, match.duration_s, match.peak_players, match.mvp_steam_id],
    );
    if (players.length) {
      await c.query(
        `INSERT INTO match_players (match_id, steam_id, name, faction, kills, deaths, cash)
         SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::int[], $6::int[], $7::bigint[])
         ON CONFLICT (match_id, steam_id) DO UPDATE SET name = EXCLUDED.name, faction = EXCLUDED.faction, kills = EXCLUDED.kills, deaths = EXCLUDED.deaths, cash = EXCLUDED.cash`,
        [match.id, players.map((p) => p.steamId), players.map((p) => p.name), players.map((p) => p.faction), players.map((p) => p.kills), players.map((p) => p.deaths), players.map((p) => p.cash)],
      );
    }
    await c.query("DELETE FROM match_sync_queue WHERE id = $1", [match.id]);
    return "processed";
  });
}

async function run(force: boolean) {
  const s = state();
  try {
    let listError: string | null = null;
    let matches: MatchSummary[] | null = null;
    try {
      const snapshot = await getMatches(force);
      if (snapshot.stale) listError = snapshot.error ?? "Wardogs match list is unavailable";
      matches = snapshot.data;
    } catch (error) {
      listError = error instanceof Error ? error.message : "Could not read the Wardogs match list";
    }
    if (matches) await enqueueMatches(matches);

    const [initialQueue] = await query<{ pending: number }>("SELECT count(*)::int AS pending FROM match_sync_queue");
    if (!initialQueue) throw new Error("Could not read the match archive queue");
    s.pending = initialQueue.pending;

    for (let i = 0; i < MAX_MATCHES_PER_RUN; i++) {
      const result = await processQueuedMatch();
      if (result === "empty" || result === "provider-unavailable") break;
      if (result === "processed") s.pending = Math.max(s.pending - 1, 0);
      if (i < MAX_MATCHES_PER_RUN - 1) await sleep(GAP_MS);
    }

    const [queue] = await query<{ pending: number; last_error: string | null }>(
      `SELECT count(*)::int AS pending,
              (array_agg(last_error ORDER BY queued_at) FILTER (WHERE last_error IS NOT NULL))[1] AS last_error
         FROM match_sync_queue`,
    );
    if (!queue) throw new Error("Could not read the match archive queue");
    s.pending = queue.pending;
    s.incomplete = s.pending > 0 || listError !== null;
    s.failed = listError !== null || Boolean(queue.last_error);
    const waiting = s.pending ? `${s.pending} match${s.pending === 1 ? "" : "es"} waiting to be archived; sync will retry automatically` : null;
    s.lastError = [listError, waiting, queue.last_error].filter(Boolean).join(". ") || null;
  } catch (err) {
    s.failed = true;
    s.incomplete = true;
    s.lastError = (err as Error).message;
    console.error("Match history sync failed:", s.lastError);
  } finally {
    s.lastRunAt = Date.now();
    s.running = null;
  }
}

/** Starts a background sync when none is running and the last one is older than a few minutes (one minute if it did not finish). Never blocks the caller. */
export function kickMatchSync(force = false): void {
  const s = state();
  if (s.running || (!force && Date.now() - s.lastRunAt < (s.incomplete ? 60_000 : 300_000))) return;
  s.running = run(force);
}

export const matchSyncStatus = () => {
  const s = state();
  return { syncing: s.running !== null, pending: Math.max(s.pending, 0), error: s.lastError, failed: s.failed, lastRunAt: s.lastRunAt };
};

export interface ProfileMatch {
  id: number;
  endedAt: string | null;
  map: string | null;
  server: string | null;
  faction: string | null;
  kills: number;
  deaths: number;
  kd: number;
  lobbyKd: number | null;
  players: number;
  mvp: boolean;
  durationS: number | null;
  startedAt: string | null;
  cash: number | null;
}

/** A player's stored matches, newest first. The lobby K/D is everyone else's kills over deaths in the same match. */
export async function getPlayerMatches(steamId: string): Promise<ProfileMatch[]> {
  const rows = await query<{
    id: string; ended_at: Date | null; started_at: Date | null; map: string | null; server_name: string | null;     faction: string | null; kills: number; deaths: number; cash: number | null;
    mvp_steam_id: string | null; duration_s: number | null; lobby_kills: string; lobby_deaths: string; players: string;
  }>(
    `SELECT m.id, m.ended_at, m.started_at, m.map, m.server_name, mp.faction, mp.kills, mp.deaths, mp.cash, m.mvp_steam_id, m.duration_s,
            (SELECT COALESCE(sum(kills),0) FROM match_players o WHERE o.match_id = m.id AND o.steam_id <> mp.steam_id AND lower(COALESCE(o.faction, '')) <> 'white') AS lobby_kills,
            (SELECT COALESCE(sum(deaths),0) FROM match_players o WHERE o.match_id = m.id AND o.steam_id <> mp.steam_id AND lower(COALESCE(o.faction, '')) <> 'white') AS lobby_deaths,
            (SELECT count(*) FROM match_players o WHERE o.match_id = m.id) AS players
       FROM match_players mp JOIN matches m ON m.id = mp.match_id
      WHERE mp.steam_id = $1 AND lower(COALESCE(mp.faction, '')) <> 'white' AND (mp.kills > 0 OR mp.deaths > 0) AND COALESCE(m.peak_players, 0) >= 80
      ORDER BY m.ended_at DESC NULLS LAST, m.id DESC`,
    [steamId],
  );
  return rows.map((r) => {
    const lk = Number(r.lobby_kills);
    const ld = Number(r.lobby_deaths);
    return {
      id: Number(r.id),
      endedAt: r.ended_at?.toISOString() ?? null,
      startedAt: r.started_at?.toISOString() ?? null,
      map: r.map,
      server: r.server_name,
      faction: r.faction,
      kills: r.kills,
      deaths: r.deaths,
      kd: r.deaths === 0 ? r.kills : Math.round((r.kills / r.deaths) * 100) / 100,
      lobbyKd: ld === 0 ? null : Math.round((lk / ld) * 100) / 100,
      players: Number(r.players),
      mvp: r.mvp_steam_id === steamId,
      durationS: r.duration_s,
      cash: r.cash === null ? null : Number(r.cash),
    };
  });
}

/** Per-player totals from stored matches inside a range (days, or null for all time), for the given Steam IDs. Rank is filled in by the caller. */
export async function getStoredTotals(steamIds: string[], days: number | null): Promise<import("@/server/services/wardogsRcon").LeaderboardRow[]> {
  if (steamIds.length === 0) return [];
  const rows = await query<{ steam_id: string; name: string | null; matches: string; kills: string; deaths: string; cash: string | null }>(
    `SELECT mp.steam_id, (array_agg(mp.name ORDER BY m.ended_at DESC NULLS LAST))[1] AS name,
            count(*) AS matches, sum(mp.kills) AS kills, sum(mp.deaths) AS deaths, sum(mp.cash) AS cash
       FROM match_players mp JOIN matches m ON m.id = mp.match_id
      WHERE mp.steam_id = ANY($1::text[]) AND lower(COALESCE(mp.faction, '')) <> 'white' AND (mp.kills > 0 OR mp.deaths > 0) AND COALESCE(m.peak_players, 0) >= 80
        AND ($2::int IS NULL OR m.ended_at >= now() - make_interval(days => $2::int))
      GROUP BY mp.steam_id`,
    [steamIds, days],
  );
  return rows.map((r) => {
    const kills = Number(r.kills);
    const deaths = Number(r.deaths);
    return { rank: 0, steamId: r.steam_id, name: r.name, kills, deaths, kd: deaths === 0 ? kills : Math.round((kills / deaths) * 100) / 100, matches: Number(r.matches), cash: r.cash === null ? null : Number(r.cash) };
  });
}

export async function storedMatchCount(): Promise<{ count: number; oldest: string | null; newest: string | null }> {
  const [r] = await query<{ count: string; oldest: Date | null; newest: Date | null }>("SELECT count(*) AS count, min(ended_at) AS oldest, max(ended_at) AS newest FROM matches");
  return { count: Number(r?.count ?? 0), oldest: r?.oldest?.toISOString() ?? null, newest: r?.newest?.toISOString() ?? null };
}
