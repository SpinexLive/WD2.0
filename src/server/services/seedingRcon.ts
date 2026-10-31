import { z } from "zod";
import { env } from "@/lib/env";
import { requestJson } from "@/lib/http";

async function game(path: string, options: { method?: "PATCH" | "POST"; body?: unknown } = {}) {
  const e = env();
  if (!e.GAME_RCON_URL || !e.GAME_RCON_PASSWORD) throw new Error("Configure GAME_RCON_URL and GAME_RCON_PASSWORD for seeding protection.");
  const { data } = await requestJson({ provider: "game-rcon", url: `${e.GAME_RCON_URL.replace(/\/+$/, "")}${path}`,
    headers: { Authorization: `Bearer ${e.GAME_RCON_PASSWORD}` }, method: options.method ?? "GET",
    body: options.body, retries: 0, timeoutMs: 5000 });
  if (!data || typeof data !== "object" || (data as { ok?: boolean }).ok === false) throw new Error("Invalid game RCON response");
  return data;
}

const playerSchema = z.object({ steamId: z.string().regex(/^\d{17}$/), name: z.string(), faction: z.string().min(1) });
export async function seedingSnapshot() {
  // Strict, uncached reads: an unavailable field must never be interpreted as an empty server.
  const start = Date.now();
  const health = z.object({ uptimeSeconds: z.number().finite().nonnegative() }).parse(await game("/v1/health"));
  const status = z.object({ map: z.string().min(1), players: z.object({ current: z.number().int().nonnegative() }),
    factionScores: z.array(z.object({ name: z.string().min(1) })).min(2) }).parse(await game("/v1/status"));
  const roster = z.object({ players: z.array(playerSchema), count: z.number().int().nonnegative() }).parse(await game("/v1/players"));
  if (roster.count !== roster.players.length || new Set(roster.players.map((p) => p.steamId)).size !== roster.count) throw new Error("Incomplete game player list");
  return { bootAt: start - health.uptimeSeconds * 1000, map: status.map,
    count: Math.max(status.players.current, roster.count), players: roster.players,
    factions: status.factionScores.map((f) => f.name) };
}

export async function moveSeedingPlayer(steamId: string, faction: string) {
  if (!/^\d{17}$/.test(steamId)) throw new Error("Invalid Steam ID");
  // No automatic HTTP retry: a timeout may mean the move succeeded. Re-observe next interval.
  await game(`/v1/players/${steamId}`, { method: "PATCH", body: { faction } });
}

export const SEEDING_AFK_REMINDER = "You are registered as Seeding AFK. When you return, click 'I'm back' on the Discord seeding message to disable AFK seeding.";

export async function remindSeedingPlayer(steamId: string) {
  if (!/^\d{17}$/.test(steamId)) throw new Error("Invalid Steam ID");
  await game(`/v1/players/${steamId}/message`, { method: "POST", body: { message: SEEDING_AFK_REMINDER } });
}
