import { z } from "zod";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { requestJson } from "@/lib/http";
import { audit } from "@/lib/audit";
import { buildServerName, readConfigServerName, replaceConfigServerName, scoreText, stripScore, type ServerNameSettings } from "@/lib/serverName";

const MIN_INTERVAL_MS = 2 * 60_000;

async function game(path: string, method: "GET" | "PUT" = "GET", body?: unknown) {
  const e = env();
  if (!e.GAME_RCON_URL || !e.GAME_RCON_PASSWORD) throw new Error("Configure GAME_RCON_URL and GAME_RCON_PASSWORD first.");
  const { data } = await requestJson({ provider: "game-rcon", url: `${e.GAME_RCON_URL.replace(/\/+$/, "")}${path}`,
    headers: { Authorization: `Bearer ${e.GAME_RCON_PASSWORD}` }, method, body, retries: 0, timeoutMs: 8000 });
  if (!data || typeof data !== "object" || (data as { ok?: boolean }).ok === false) throw new Error("Invalid game RCON response");
  return data;
}

const statusSchema = z.object({
  serverName: z.string(),
  factionScores: z.array(z.object({ name: z.string().min(1), score: z.number().finite() })),
});
const configSchema = z.object({ revision: z.string().min(1), text: z.string().min(1) });
const putSchema = z.object({ ok: z.literal(true), errors: z.array(z.unknown()).default([]) });

async function liveStatus() { return statusSchema.parse(await game("/v1/status")); }

async function writeName(name: string) {
  const cfg = configSchema.parse(await game("/v1/config"));
  const current = readConfigServerName(cfg.text);
  if (current === name) return;
  const res = putSchema.parse(await game("/v1/config", "PUT", { revision: cfg.revision, text: replaceConfigServerName(cfg.text, name) }));
  if (res.errors.length) throw new Error("The game server rejected the new name");
}

interface Row { enabled: boolean; base_name: string; last_name: string | null; last_renamed_at: string | null; last_error: string | null }
async function row(): Promise<Row> {
  return (await query<Row>("SELECT enabled, base_name, last_name, last_renamed_at, last_error FROM server_name_settings WHERE id=1"))[0]!;
}

export async function serverNameStatus() {
  const r = await row();
  let live: { currentName: string; scores: string } | null = null;
  let liveError: string | null = null;
  try {
    const s = await liveStatus();
    live = { currentName: s.serverName, scores: scoreText(s.factionScores) };
  } catch (e) {
    liveError = (e as Error).message;
  }
  return {
    enabled: r.enabled, baseName: r.base_name, lastName: r.last_name, lastRenamedAt: r.last_renamed_at, lastError: r.last_error,
    live, liveError, suggestedBase: live ? stripScore(live.currentName) : null,
  };
}

export async function saveServerNameSettings(settings: ServerNameSettings, actor: Parameters<typeof audit>[0]) {
  await query("UPDATE server_name_settings SET enabled=$1, base_name=$2, updated_by=$3, last_error=NULL WHERE id=1", [settings.enabled, settings.baseName, actor.discordId]);
  // Apply straight away: scored name when enabled, plain base name when disabled.
  try {
    await applyNow(settings.enabled, settings.baseName);
  } catch (e) {
    await query("UPDATE server_name_settings SET last_error=$1 WHERE id=1", [(e as Error).message]);
  }
  await audit(actor, "server_name.settings", "server_name", "1", { enabled: settings.enabled, baseName: settings.baseName });
  return serverNameStatus();
}

async function applyNow(enabled: boolean, base: string) {
  const s = await liveStatus();
  const target = enabled ? buildServerName(base, s.factionScores) : base;
  if (s.serverName === target) return;
  await writeName(target);
  await query("UPDATE server_name_settings SET last_name=$1, last_renamed_at=now(), last_error=NULL WHERE id=1", [target]);
}

let busy = false;
export async function serverNameTick() {
  if (busy) return;
  busy = true;
  try {
    const r = await row();
    if (!r.enabled || !r.base_name) return;
    if (r.last_renamed_at && Date.now() - new Date(r.last_renamed_at).getTime() < MIN_INTERVAL_MS) return;
    await applyNow(true, r.base_name);
  } catch (e) {
    await query("UPDATE server_name_settings SET last_error=$1 WHERE id=1", [(e as Error).message]).catch(() => undefined);
    console.error("Server name worker:", (e as Error).message);
  } finally {
    busy = false;
  }
}

const globalState = globalThis as unknown as { __serverNameTimer?: NodeJS.Timeout };
export function startServerNameScheduler() {
  if (process.env.NEXT_PHASE === "phase-production-build" || globalState.__serverNameTimer) return;
  globalState.__serverNameTimer = setInterval(() => void serverNameTick(), 30_000);
  globalState.__serverNameTimer.unref();
}
