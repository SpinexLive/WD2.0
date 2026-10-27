import { query } from "@/lib/db";
import { resolveLinks } from "./links";
import { getAllClanMembers, getClanMembers } from "./discord";
import { getPlayerMatches, getStoredTotals } from "./matchHistory";
import { MIN_KD_MATCHES } from "@/lib/leaderboardMerge";

export interface ClanPlayer {
  discordId: string;
  steamId: string;
  name: string;
}

/** Clan members with a linked Steam account, named by their Discord nickname. */
export async function getClanPlayers(): Promise<ClanPlayer[]> {
  const [links, clan, allClan] = await Promise.all([resolveLinks(), getClanMembers().then((s) => s.data, () => []), getAllClanMembers().then((s) => s.data, () => [])]);
  const names = new Map([...allClan, ...clan].map((m) => [m.id, m.displayName]));
  const out: ClanPlayer[] = [];
  for (const [discordId, steamId] of links.steamIds) {
    const name = names.get(discordId);
    if (name) out.push({ discordId, steamId, name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface CompareTotals {
  label: string;
  kd: number | null;
  avgCash: number | null;
  matches: number;
}
export interface CompareResult {
  withLabel: string;
  series: { matchId: number; kd: number | null; cash: number | null }[];
  me: CompareTotals;
  other: CompareTotals;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Per-match K/D and cash of `otherIds` (summed K/D, averaged cash) for the matches the subject played. */
export async function comparisonSeries(matchIds: number[], otherIds: string[], excludeSteamId: string) {
  if (matchIds.length === 0 || otherIds.length === 0) return [];
  const rows = await query<{ match_id: string; k: string; d: string; c: string | null }>(
    `SELECT mp.match_id, sum(mp.kills) AS k, sum(mp.deaths) AS d, avg(mp.cash) AS c
       FROM match_players mp JOIN matches m ON m.id = mp.match_id
      WHERE mp.match_id = ANY($1::bigint[]) AND mp.steam_id = ANY($2::text[]) AND mp.steam_id <> $3
        AND lower(COALESCE(mp.faction, '')) <> 'white' AND (mp.kills > 0 OR mp.deaths > 0) AND COALESCE(m.peak_players, 0) >= 80
      GROUP BY mp.match_id`,
    [matchIds, otherIds, excludeSteamId],
  );
  return rows.map((r) => {
    const k = Number(r.k);
    const d = Number(r.d);
    return { matchId: Number(r.match_id), kd: d === 0 ? k : round2(k / d), cash: r.c === null ? null : Math.round(Number(r.c)) };
  });
}

export async function buildCompare(subject: ClanPlayer, withKey: string, players: ClanPlayer[]): Promise<CompareResult | null> {
  const mine = await getPlayerMatches(subject.steamId);
  const matchIds = mine.map((m) => m.id);
  const [mineTotals] = await getStoredTotals([subject.steamId], null);
  const toTotals = (label: string, t: { kd: number; cash: number | null; matches: number } | undefined): CompareTotals => ({
    label,
    kd: t ? t.kd : null,
    avgCash: t && t.cash !== null && t.matches > 0 ? Math.round(t.cash / t.matches) : null,
    matches: t?.matches ?? 0,
  });
  const me = toTotals("You", mineTotals);

  if (withKey === "clan") {
    const ids = players.filter((p) => p.steamId !== subject.steamId).map((p) => p.steamId);
    const [series, totals] = await Promise.all([comparisonSeries(matchIds, ids, subject.steamId), getStoredTotals(ids, null)]);
    const eligible = totals.filter((t) => t.matches >= MIN_KD_MATCHES);
    const avg = (f: (t: (typeof eligible)[number]) => number | null) => {
      const v = eligible.flatMap((t) => (f(t) === null ? [] : [f(t)!]));
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const kd = avg((t) => t.kd);
    const cash = avg((t) => (t.cash !== null && t.matches > 0 ? t.cash / t.matches : null));
    return {
      withLabel: "Clan average",
      series,
      me,
      other: { label: "Clan average", kd: kd === null ? null : round2(kd), avgCash: cash === null ? null : Math.round(cash), matches: eligible.length },
    };
  }

  const other = players.find((p) => p.discordId === withKey);
  if (!other || other.steamId === subject.steamId) return null;
  const [series, [t]] = await Promise.all([comparisonSeries(matchIds, [other.steamId], subject.steamId), getStoredTotals([other.steamId], null)]);
  return { withLabel: other.name, series, me, other: toTotals(other.name, t) };
}
