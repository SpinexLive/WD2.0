import { z } from "zod";
import { query } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { audit } from "@/lib/audit";
import type { Session } from "@/lib/session";
import { getAllClanMembers, getClanMembers } from "./discord";
import { resolveLinks } from "./links";

export const MIN_MATCHES = 5;
/** A candidate must reach this share of the top-10 average on both K/D and cash. */
export const TOLERANCE = 0.9;
const TOP_N = 10;

export interface RecruitCandidate {
  steamId: string;
  name: string | null;
  matches: number;
  kills: number;
  deaths: number;
  kd: number;
  avgCash: number | null;
  mvps: number;
  lastPlayed: string | null;
  score: number;
  status: "new" | "contacted" | "dismissed";
  note: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface RecruitReport {
  benchmark: { kd: number; avgCash: number; players: number; minKd: number; minCash: number };
  candidates: RecruitCandidate[];
  excludedClan: number;
  minMatches: number;
}

interface Agg {
  steam_id: string;
  name: string | null;
  matches: string;
  kills: string;
  deaths: string;
  avg_cash: string | null;
  mvps: string;
  last_played: Date | null;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Players seen on the game server with enough stored matches whose K/D and cash are close to our top 10 clan members. Already-in-clan players are excluded by Discord link. */
export async function buildRecruitReport(): Promise<RecruitReport> {
  const [rows, clan, allClan, links, statusRows] = await Promise.all([
    query<Agg>(
      `SELECT mp.steam_id,
              (array_agg(mp.name ORDER BY m.ended_at DESC NULLS LAST))[1] AS name,
              count(*) AS matches, sum(mp.kills) AS kills, sum(mp.deaths) AS deaths,
              avg(mp.cash) AS avg_cash,
              count(*) FILTER (WHERE m.mvp_steam_id = mp.steam_id) AS mvps,
              max(m.ended_at) AS last_played
         FROM match_players mp JOIN matches m ON m.id = mp.match_id
        WHERE lower(COALESCE(mp.faction, '')) <> 'white' AND (mp.kills > 0 OR mp.deaths > 0) AND COALESCE(m.peak_players, 0) >= 80
        GROUP BY mp.steam_id
       HAVING count(*) >= $1`,
      [MIN_MATCHES],
    ),
    getClanMembers().then((s) => s.data),
    getAllClanMembers().then((s) => s.data),
    resolveLinks(),
    query<{ steam_id: string; status: "contacted" | "dismissed"; note: string | null; updated_by_name: string; updated_at: Date }>("SELECT steam_id, status, note, updated_by_name, updated_at FROM recruit_status"),
  ]);

  const clanDiscord = new Set([...clan, ...allClan].map((m) => m.id));
  const clanSteam = new Set<string>();
  for (const [discordId, steamId] of links.steamIds) if (clanDiscord.has(discordId)) clanSteam.add(steamId);

  const stats = rows.map((r) => {
    const kills = Number(r.kills);
    const deaths = Number(r.deaths);
    return {
      steamId: r.steam_id,
      name: r.name,
      matches: Number(r.matches),
      kills,
      deaths,
      kd: deaths === 0 ? kills : kills / deaths,
      avgCash: r.avg_cash === null ? null : Number(r.avg_cash),
      mvps: Number(r.mvps),
      lastPlayed: r.last_played?.toISOString() ?? null,
    };
  });

  // Rank clan members by K/D and cash relative to the average of everyone, so neither stat drowns out the other.
  const withCash = stats.filter((s) => s.avgCash !== null);
  const meanKd = withCash.reduce((a, s) => a + s.kd, 0) / (withCash.length || 1) || 1;
  const meanCash = withCash.reduce((a, s) => a + (s.avgCash ?? 0), 0) / (withCash.length || 1) || 1;
  const score = (s: { kd: number; avgCash: number | null }) => (s.kd / meanKd + (s.avgCash ?? 0) / meanCash) / 2;

  const top = withCash.filter((s) => clanSteam.has(s.steamId)).sort((a, b) => score(b) - score(a)).slice(0, TOP_N);
  if (top.length === 0) throw new HttpError(409, `No clan members have ${MIN_MATCHES}+ stored matches yet, so there is no top 10 to compare against.`, "no_benchmark");
  const bKd = top.reduce((a, s) => a + s.kd, 0) / top.length;
  const bCash = top.reduce((a, s) => a + (s.avgCash ?? 0), 0) / top.length;
  const minKd = bKd * TOLERANCE;
  const minCash = bCash * TOLERANCE;

  const status = new Map(statusRows.map((r) => [r.steam_id, r]));
  const candidates = withCash
    .filter((s) => !clanSteam.has(s.steamId) && s.kd >= minKd && (s.avgCash ?? 0) >= minCash)
    .sort((a, b) => score(b) - score(a))
    .map<RecruitCandidate>((s) => {
      const st = status.get(s.steamId);
      return {
        ...s,
        kd: round(s.kd),
        avgCash: s.avgCash === null ? null : Math.round(s.avgCash),
        score: round(score(s)),
        status: st?.status ?? "new",
        note: st?.note ?? null,
        updatedBy: st?.updated_by_name ?? null,
        updatedAt: st?.updated_at.toISOString() ?? null,
      };
    });

  return { benchmark: { kd: round(bKd), avgCash: Math.round(bCash), players: top.length, minKd: round(minKd), minCash: Math.round(minCash) }, candidates, excludedClan: clanSteam.size, minMatches: MIN_MATCHES };
}

export const recruitUpdateSchema = z.object({ status: z.enum(["new", "contacted", "dismissed"]), note: z.string().trim().max(500).optional() }).strict();

export async function setRecruitStatus(actor: Session, steamId: string, input: z.infer<typeof recruitUpdateSchema>) {
  if (!/^\d{17}$/.test(steamId)) throw new HttpError(400, "Invalid Steam ID", "invalid_input");
  if (input.status === "new") {
    await query("DELETE FROM recruit_status WHERE steam_id = $1", [steamId]);
  } else {
    await query(
      `INSERT INTO recruit_status (steam_id, status, note, updated_by_id, updated_by_name) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (steam_id) DO UPDATE SET status = EXCLUDED.status, note = COALESCE(EXCLUDED.note, recruit_status.note), updated_by_id = EXCLUDED.updated_by_id, updated_by_name = EXCLUDED.updated_by_name, updated_at = now()`,
      [steamId, input.status, input.note || null, actor.discordId, actor.displayName],
    );
  }
  await audit(actor, `recruit.${input.status}`, "steam", steamId, input.note ? { note: input.note } : {});
  return { ok: true };
}
