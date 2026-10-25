import { env } from "@/lib/env";
import { requestJson, ProviderError } from "@/lib/http";
import { cached, type Snapshot } from "@/lib/cache";

/*
 * Only documented read endpoints (https://wardogsbot.com/developers) are used: GET /servers, GET /servers/{id}/live, GET /matches\n * and GET /players/{steamId} (read scope). No moderate/control/config actions are implemented. Response fields are not documented, so they are
 * parsed defensively. GET /players/{steamId} supplies K/D for a Steam ID that was matched elsewhere; the API itself has no Discord mapping.
 */

const BASE = "https://wardogsbot.com/api/v1";
const headers = () => ({ Authorization: `Bearer ${env().WARDOGS_API_KEY}` });

export interface RconServer {
  id: string;
  name: string | null;
  online: boolean | null;
  players: number | null;
  map: string | null;
}
export interface RconPlayer {
  steamId: string | null;
  name: string | null;
  kills: number | null;
  deaths: number | null;
  ping: number | null;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);


async function get(path: string): Promise<Record<string, unknown>> {
  const { data } = await requestJson({ provider: "wardogs-rcon", url: `${BASE}${path}`, headers: headers() });
  const o = obj(data);
  if (!o || o.ok === false) throw new ProviderError("wardogs-rcon", "Wardogs API returned an error response");
  return o;
}

export function getServers(force = false): Promise<Snapshot<RconServer[]>> {
  return cached("rcon:servers", 30_000, async () => {
    const o = await get("/servers");
    const list = o.servers ?? o.data;
    if (!Array.isArray(list)) throw new ProviderError("wardogs-rcon", "Unrecognised Wardogs servers response format");
    return list.flatMap((s) => {
      const x = obj(s);
      const id = x && str(x.id ?? x.serverId);
      if (!x || !id) return [];
      return [{ id, name: str(x.name), online: typeof x.online === "boolean" ? x.online : null, players: num(x.players ?? x.playerCount), map: str(x.map) }];
    });
  }, force);
}

export function getLive(serverId: string, force = false): Promise<Snapshot<{ map: string | null; players: RconPlayer[] }>> {
  if (!/^[\w-]{1,64}$/.test(serverId)) throw new ProviderError("wardogs-rcon", "Invalid server id");
  return cached(`rcon:live:${serverId}`, 10_000, async () => {
    const o = await get(`/servers/${encodeURIComponent(serverId)}/live`);
    const root = obj(o.live) ?? o;
    const list = Array.isArray(root.players) ? root.players : [];
    return {
      map: str(root.map) ?? str(obj(root.status)?.map),
      players: list.flatMap((p) => {
        const x = obj(p);
        return x ? [{ steamId: str(x.steamId ?? x.steamID ?? x.steam_id), name: str(x.name), kills: num(x.kills), deaths: num(x.deaths), ping: num(x.ping) }] : [];
      }),
    };
  }, force);
}


export interface PlayerStats {
  name: string | null;
  kills: number;
  deaths: number;
  matches: number;
  seedingSeconds: number | null;
  kd: number | null;
}

/** Null when the community has no record of the player (the API answers with zeros and a null name). */
export function getPlayerStats(steamId: string, force = false): Promise<Snapshot<PlayerStats | null>> {
  if (!/^\d{17}$/.test(steamId)) throw new ProviderError("wardogs-rcon", "Invalid Steam ID");
  return cached(`rcon:player:${steamId}`, 300_000, async () => {
    const o = await get(`/players/${steamId}`);
    const s = obj(o.stats);
    const kills = num(s?.kills);
    const deaths = num(s?.deaths);
    const matches = num(s?.matches) ?? 0;
    if (!s || kills === null || deaths === null || (s.name == null && matches === 0 && kills === 0 && deaths === 0)) return null;
    return { name: str(s.name), kills, deaths, matches, seedingSeconds: num(s.seedingSeconds), kd: deaths === 0 ? kills : Math.round((kills / deaths) * 100) / 100 };
  }, force);
}
/** Official Discord -> Steam links from the Wardogs bot (GET /links, needs the `links` scope). Discord IDs are strings; a Discord or Steam ID that appears more than once is dropped as ambiguous. */
export function getOfficialLinks(force = false): Promise<Snapshot<Map<string, string>>> {
  return cached("rcon:links", 600_000, async () => {
    const o = await get("/links");
    if (!Array.isArray(o.links)) throw new ProviderError("wardogs-rcon", "Unrecognised Wardogs links response format");
    const byDiscord = new Map<string, string[]>();
    const bySteam = new Map<string, number>();
    for (const l of o.links) {
      const x = obj(l);
      const discordId = str(x?.discordId);
      const steamId = str(x?.steamId);
      if (!discordId || !steamId || !/^\d{17}$/.test(steamId) || !/^\d{17,20}$/.test(discordId)) continue;
      byDiscord.set(discordId, [...(byDiscord.get(discordId) ?? []), steamId]);
      bySteam.set(steamId, (bySteam.get(steamId) ?? 0) + 1);
    }
    const out = new Map<string, string>();
    for (const [d, steams] of byDiscord) {
      if (steams.length === 1 && bySteam.get(steams[0]!) === 1) out.set(d, steams[0]!);
    }
    return out;
  }, force);
}

export interface MatchSummary {
  id: number;
  serverName: string | null;
  map: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationS: number | null;
  peakPlayers: number | null;
  mvpSteamId: string | null;
}

/** The API returns at most the latest 100 matches and offers no paging. */
export function getMatches(force = false): Promise<Snapshot<MatchSummary[]>> {
  return cached("rcon:matches", 300_000, async () => {
    const o = await get("/matches?limit=100");
    if (!Array.isArray(o.matches)) throw new ProviderError("wardogs-rcon", "Unrecognised Wardogs matches response format");
    return o.matches.flatMap((m) => {
      const x = obj(m);
      const id = num(x?.id);
      if (!x || id === null) return [];
      return [{ id, serverName: str(x.serverName), map: str(x.map), startedAt: str(x.startedAt), endedAt: str(x.endedAt), durationS: num(x.durationS), peakPlayers: num(x.peakPlayers), mvpSteamId: str(obj(x.mvp)?.steamId) }];
    });
  }, force);
}

export interface MatchPlayerRow {
  steamId: string;
  name: string | null;
  faction: string | null;
  kills: number;
  deaths: number;
  cash: number | null;
}

/** Every player who took part in one match. */
export async function getMatchPlayers(matchId: number): Promise<MatchPlayerRow[]> {
  if (!Number.isInteger(matchId) || matchId < 0) throw new ProviderError("wardogs-rcon", "Invalid match id");
  const o = await get(`/matches/${matchId}`);
  if (!Array.isArray(o.players)) throw new ProviderError("wardogs-rcon", "Unrecognised Wardogs match response format");
  return o.players.flatMap((p) => {
    const x = obj(p);
    const steamId = str(x?.steamId);
    const kills = num(x?.kills);
    const deaths = num(x?.deaths);
    return x && steamId && /^\d{17}$/.test(steamId) && kills !== null && deaths !== null ? [{ steamId, name: str(x.name), faction: str(x.faction), kills, deaths, cash: num(x.cash) }] : [];
  });
}

/** Server-wide all-time rank by kills, for players inside the top 100 (the API's maximum page). */
export function getLeaderboardRanks(force = false): Promise<Snapshot<Map<string, { rank: number; kd: number | null }>>> {
  return cached("rcon:leaderboard", 600_000, async () => {
    const o = await get("/leaderboard?range=all&sort=kills&limit=100");
    const rows = obj(o.leaderboard)?.rows;
    if (!Array.isArray(rows)) throw new ProviderError("wardogs-rcon", "Unrecognised Wardogs leaderboard response format");
    const out = new Map<string, { rank: number; kd: number | null }>();
    for (const r of rows) {
      const x = obj(r);
      const steamId = str(x?.steamId);
      const rank = num(x?.rank);
      if (x && steamId && rank !== null) out.set(steamId, { rank, kd: num(x.kd) });
    }
    return out;
  }, force);
}
