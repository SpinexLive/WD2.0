import { query, tx } from "@/lib/db";
import { getMatches, getMatchPlayers } from "@/server/services/wardogsRcon";

const CONCURRENCY = 1;
// The API allows 120 requests a minute per key, shared with links and stats lookups, so the sync keeps well under that.
const GAP_MS = 750;
const RATE_LIMIT_WAIT_MS = 20_000;
const MAX_RATE_LIMIT_WAITS = 6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SyncState { running: Promise<void> | null; lastRunAt: number; pending: number; lastError: string | null; incomplete: boolean }
const g = globalThis as unknown as { __matchSync?: SyncState };
const state = (): SyncState => (g.__matchSync ??= { running: null, lastRunAt: 0, pending: 0, lastError: null, incomplete: false });

async function storeMatch(id: number, m: Awaited<ReturnType<typeof getMatches>>["data"][number]) {
  const players = await getMatchPlayers(id);
  await tx(async (c) => {
    await c.query(
      `INSERT INTO matches (id, server_name, map, started_at, ended_at, duration_s, peak_players, mvp_steam_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET server_name = EXCLUDED.server_name, map = EXCLUDED.map, started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at,
         duration_s = EXCLUDED.duration_s, peak_players = EXCLUDED.peak_players, mvp_steam_id = EXCLUDED.mvp_steam_id, synced_at = now()`,
      [id, m.serverName, m.map, m.startedAt, m.endedAt, m.durationS, m.peakPlayers, m.mvpSteamId],
    );
    if (players.length) {
      await c.query(
        `INSERT INTO match_players (match_id, steam_id, name, faction, kills, deaths, cash)
         SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::int[], $6::int[], $7::bigint[])
         ON CONFLICT (match_id, steam_id) DO UPDATE SET name = EXCLUDED.name, faction = EXCLUDED.faction, kills = EXCLUDED.kills, deaths = EXCLUDED.deaths, cash = EXCLUDED.cash`,
        [id, players.map((p) => p.steamId), players.map((p) => p.name), players.map((p) => p.faction), players.map((p) => p.kills), players.map((p) => p.deaths), players.map((p) => p.cash)],
      );
    }
  });
}

async function run(force: boolean) {
  const s = state();
  try {
    const list = (await getMatches(force)).data.filter((m) => m.endedAt);
    const have = new Set((await query<{ id: string }>("SELECT id FROM matches WHERE id = ANY($1::bigint[])", [list.map((m) => m.id)])).map((r) => Number(r.id)));
    // Oldest first, so an interrupted run leaves a contiguous history.
    const todo = list.filter((m) => !have.has(m.id)).sort((a, b) => a.id - b.id);
    s.pending = todo.length;
    let failed = 0;
    let next = 0;
    let waits = 0;
    let stop = false;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next < todo.length && !stop) {
          const m = todo[next++]!;
          try {
            await storeMatch(m.id, m);
            s.pending--;
          } catch (err) {
            if ((err as { status?: number }).status === 429 && waits < MAX_RATE_LIMIT_WAITS) {
              waits++;
              next--;
              await sleep(RATE_LIMIT_WAIT_MS);
              continue;
            }
            failed++;
            s.pending--;
            if ((err as { status?: number }).status === 429) stop = true;
          }
          await sleep(GAP_MS);
        }
      }),
    );
    const left = todo.length - next + failed;
    s.pending = left;
    s.incomplete = left > 0;
    s.lastError = left ? `${left} match${left === 1 ? "" : "es"} still to read; syncing resumes automatically` : null;
  } catch (err) {
    s.incomplete = true;
    s.lastError = (err as Error).message;
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
  return { syncing: s.running !== null, pending: Math.max(s.pending, 0), error: s.lastError };
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
}

/** A player's stored matches, newest first. The lobby K/D is everyone else's kills over deaths in the same match. */
export async function getPlayerMatches(steamId: string): Promise<ProfileMatch[]> {
  const rows = await query<{
    id: string; ended_at: Date | null; started_at: Date | null; map: string | null; server_name: string | null; faction: string | null; kills: number; deaths: number;
    mvp_steam_id: string | null; duration_s: number | null; lobby_kills: string; lobby_deaths: string; players: string;
  }>(
    `SELECT m.id, m.ended_at, m.started_at, m.map, m.server_name, mp.faction, mp.kills, mp.deaths, m.mvp_steam_id, m.duration_s,
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
    };
  });
}

export async function storedMatchCount(): Promise<{ count: number; oldest: string | null; newest: string | null }> {
  const [r] = await query<{ count: string; oldest: Date | null; newest: Date | null }>("SELECT count(*) AS count, min(ended_at) AS oldest, max(ended_at) AS newest FROM matches");
  return { count: Number(r?.count ?? 0), oldest: r?.oldest?.toISOString() ?? null, newest: r?.newest?.toISOString() ?? null };
}
