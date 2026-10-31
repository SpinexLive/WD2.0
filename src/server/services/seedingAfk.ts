import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { query, independentQuery, tx } from "@/lib/db";
import { env } from "@/lib/env";
import { balancedDestination, seedingSettingsSchema, type SeedingSettings } from "@/lib/seedingAfk";
import { postMessage, editMessage, type DiscordMessagePayload } from "./discord";
import { resolveLinks } from "./links";
import { seedingSnapshot, moveSeedingPlayer, remindSeedingPlayer } from "./seedingRcon";

export const SEEDING_BUTTON = "seeding-afk";
const LOCK = 824024;
interface Runtime {
  sessionId?: string; bootAt?: number; map?: string; terminated?: boolean; reason?: string;
  thresholdReached?: boolean; countBased?: boolean;
  lastError?: string | null; lastPollAt?: string; count?: number;
}
interface Store { settings: SeedingSettings; runtime: Runtime }
interface Registration { discord_id: string; steam_id: string; session_id: string; registered_at: Date; next_switch_at: Date; next_reminder_at: Date }
async function read(c: PoolClient): Promise<Store> {
  const { rows } = await c.query("SELECT settings, runtime FROM seeding_afk WHERE id=true FOR UPDATE");
  if (!rows[0]) throw new Error("Apply the seeding AFK database migration first");
  return { settings: seedingSettingsSchema.parse(rows[0].settings), runtime: rows[0].runtime };
}
async function persist(c: PoolClient, s: Store) {
  await c.query("UPDATE seeding_afk SET settings=$1,runtime=$2 WHERE id=true", [JSON.stringify(s.settings), JSON.stringify(s.runtime)]);
}
async function log(c: PoolClient, action: string, discordId: string | null = null, details: Record<string, unknown> = {}) {
  // Logging failure must not roll back a reservation after a game action was sent.
  await independentQuery("INSERT INTO audit_logs (actor_id,actor_name,action,target_type,target_id,details) VALUES ($1,$2,$3,'seeding-afk',$4,$5)",
    [discordId ?? "system:seeding-afk", discordId ?? "Seeding AFK worker", `seeding_afk.${action}`, env().WARDOGS_RCON_SERVER_ID ?? "direct-rcon", JSON.stringify(details)])
    .catch(() => console.error(`Seeding AFK audit unavailable: ${action}`));
}
async function terminate(c: PoolClient, s: Store, reason: string) {
  await c.query("DELETE FROM seeding_afk_players");
  if (!s.runtime.terminated || s.runtime.reason !== reason) await log(c, "terminated", null, { reason });
  s.runtime.terminated = true;
  s.runtime.reason = reason;
}
async function exclusive<T>(fn: (c: PoolClient, s: Store) => Promise<T>): Promise<T> {
  return tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock($1)", [LOCK]);
    const s = await read(c);
    const result = await fn(c, s);
    await persist(c, s);
    return result;
  });
}

/** Observations can terminate a session, but never reactivate it after a threshold trip. */
async function observe(c: PoolClient, s: Store) {
  const live = await seedingSnapshot();
  const r = s.runtime;
  const changed = !r.sessionId || r.bootAt === undefined || Math.abs(r.bootAt - live.bootAt) > 5000 || r.map !== live.map;
  if (changed || !r.countBased) {
    await c.query("DELETE FROM seeding_afk_players");
    // Preserve a threshold stop when upgrading an existing running session.
    r.thresholdReached = changed ? false : r.thresholdReached || r.reason === "Player threshold reached";
    r.sessionId = randomUUID();
    r.bootAt = live.bootAt;
    r.countBased = true;
    await log(c, "session_started");
  }
  r.map = live.map;
  r.count = live.count;
  r.lastPollAt = new Date().toISOString();
  if (!s.settings.enabled) await terminate(c, s, "Protection disabled");
  else if (live.count >= s.settings.threshold || r.thresholdReached) {
    if (!r.thresholdReached) await log(c, "threshold_reached", null, { count: live.count, threshold: s.settings.threshold });
    r.thresholdReached = true;
    await terminate(c, s, "Player threshold reached");
  } else {
    // A healthy low-count observation allows new consent after a transient outage.
    r.terminated = false;
    r.reason = "Seeding (below player threshold)";
  }
  r.lastError = null;
  return live;
}

export async function seedingTick() {
  const candidates = await tx(async (c) => {
    // No queued ticks, and exactly one worker across processes.
    const { rows } = await c.query("SELECT pg_try_advisory_xact_lock($1) AS acquired", [LOCK]);
    if (!rows[0]?.acquired) return [];
    const s = await read(c);
    if (!s.settings.enabled) { await terminate(c, s, "Protection disabled"); await persist(c, s); return []; }
    try {
      const live = await observe(c, s);
      const { rows: registered } = await c.query<Registration>("SELECT * FROM seeding_afk_players ORDER BY next_switch_at");
      for (const p of registered) {
        if (!live.players.some((x) => x.steamId === p.steam_id)) {
          await c.query("DELETE FROM seeding_afk_players WHERE discord_id=$1", [p.discord_id]);
          await log(c, "disconnected", p.discord_id, { steamId: p.steam_id });
          continue;
        }
      }
      await persist(c, s);
      return s.runtime.terminated ? [] : registered.map((p) => p.discord_id);
    } catch (e) {
      // An outage invalidates consent for the old session. Recovery requires fresh player registration.
      s.runtime.lastError = (e as Error).message;
      await terminate(c, s, "RCON unavailable or safety data incomplete");
    }
    await persist(c, s);
    return [];
  });
  // Release the lock between players so returns and settings changes can run.
  for (const discordId of candidates) {
    await seedingReminder(discordId);
    await tx(async (c) => {
    const { rows } = await c.query("SELECT pg_try_advisory_xact_lock($1) AS acquired", [LOCK]);
    if (!rows[0]?.acquired) return;
    const s = await read(c);
    const { rows: [p] } = await c.query<Registration>("SELECT * FROM seeding_afk_players WHERE discord_id=$1", [discordId]);
    if (!p || s.runtime.terminated || !s.settings.enabled || p.session_id !== s.runtime.sessionId || p.next_switch_at.getTime() > Date.now()) return;
    try {
      const live = await observe(c, s);
      if (!s.runtime.terminated) {
        const faction = balancedDestination(live.players, live.factions, p.steam_id, live.balanceLimit);
        // Commit the cooldown separately BEFORE the HTTP write, surviving worker crashes and ambiguous timeouts.
        // A concurrent return can delete this row while safety reads are in progress.
        const reserved = await independentQuery("UPDATE seeding_afk_players SET next_switch_at=now()+($2 * interval '1 second') WHERE discord_id=$1 AND session_id=$3 RETURNING discord_id", [p.discord_id, s.settings.intervalSeconds, s.runtime.sessionId]);
        if (reserved.length) {
          if (!live.players.some((x) => x.steamId === p.steam_id)) {
            await c.query("DELETE FROM seeding_afk_players WHERE discord_id=$1", [p.discord_id]);
            await log(c, "disconnected", p.discord_id);
          } else if (!faction) await log(c, "balance_skipped", p.discord_id, { steamId: p.steam_id });
          else {
            await moveSeedingPlayer(p.steam_id, faction);
            await log(c, "team_switched", p.discord_id, { steamId: p.steam_id, faction });
          }
        }
      }
    } catch (e) {
      s.runtime.lastError = (e as Error).message;
      await log(c, "move_failed", p.discord_id, { error: s.runtime.lastError });
      await terminate(c, s, "RCON unavailable or safety data incomplete");
    }
    await persist(c, s);
    });
  }
}

async function seedingReminder(discordId: string) {
  await tx(async (c) => {
    const { rows } = await c.query("SELECT pg_try_advisory_xact_lock($1) AS acquired", [LOCK]);
    if (!rows[0]?.acquired) return;
    const s = await read(c);
    const { rows: [p] } = await c.query<Registration>("SELECT * FROM seeding_afk_players WHERE discord_id=$1", [discordId]);
    if (!p || s.runtime.terminated || !s.settings.enabled || p.session_id !== s.runtime.sessionId || p.next_reminder_at.getTime() > Date.now()) return;
    try {
      const live = await observe(c, s);
      if (!s.runtime.terminated && live.players.some((player) => player.steamId === p.steam_id)) {
        // Persist independently before sending: concurrent workers and timeouts must not duplicate whispers.
        const claimed = await independentQuery("UPDATE seeding_afk_players SET next_reminder_at=now()+interval '60 seconds' WHERE discord_id=$1 AND session_id=$2 AND next_reminder_at<=now() RETURNING discord_id", [p.discord_id, p.session_id]);
        if (claimed.length) {
          try { await remindSeedingPlayer(p.steam_id); }
          catch (e) {
            // A reminder failure must not disable protection. Retry at the next minute, without replaying HTTP writes.
            s.runtime.lastError = (e as Error).message;
            await log(c, "reminder_failed", p.discord_id, { error: s.runtime.lastError });
          }
        }
      }
    } catch (e) {
      s.runtime.lastError = (e as Error).message;
      await terminate(c, s, "RCON unavailable or safety data incomplete");
    }
    await persist(c, s);
  });
}

export async function seedingButton(input: { guildId?: string | null; channelId?: string | null; messageId?: string; userId: string; customId: string }): Promise<string> {
  if (input.guildId !== env().DISCORD_GUILD_ID) return "This button belongs to a different server.";
  if (input.customId === `${SEEDING_BUTTON}:back`) {
    // Withdrawal does not wait for a slow RCON observation. The worker rechecks consent before sending.
    const [row] = await query<{ settings: SeedingSettings }>("SELECT settings FROM seeding_afk WHERE id=true");
    if (input.channelId !== row?.settings.channelId || input.messageId !== row?.settings.messageId) return "This registration message is no longer active.";
    const removed = await query("DELETE FROM seeding_afk_players WHERE discord_id=$1 RETURNING steam_id", [input.userId]);
    // Drain any action already in flight before acknowledging the return; clear a racing registration too.
    await exclusive(async (c) => {
      await c.query("DELETE FROM seeding_afk_players WHERE discord_id=$1", [input.userId]);
      if (removed.length) await log(c, "unregistered", input.userId);
    });
    return "You are no longer registered as Seeding AFK. In-game reminders and automatic team switching are stopped. Normal inactivity rules apply.";
  }
  return exclusive(async (c, s) => {
    if (input.channelId !== s.settings.channelId || input.messageId !== s.settings.messageId) return "This registration message is no longer active.";
    if (input.customId !== `${SEEDING_BUTTON}:register`) return "Unknown seeding action.";
    if (!s.settings.enabled) return "Seeding AFK protection is disabled.";
    let live;
    try { live = await observe(c, s); } catch { await terminate(c, s, "RCON unavailable or safety data incomplete"); return "Cannot verify the game session. Protection is stopped; please try later."; }
    if (s.runtime.terminated || !s.runtime.sessionId) return `Protection is stopped: ${s.runtime.reason ?? "waiting for a server player count"}.`;
    const links = await resolveLinks(true);
    if (links.source.stale) return "Account links are stale. Please try again shortly.";
    const steamId = links.steamIds.get(input.userId);
    if (!steamId) return "Link your Discord account to your game account before registering.";
    if ([...links.steamIds.values()].filter((id) => id === steamId).length !== 1) return "Your game account link is ambiguous. Contact an administrator.";
    const player = live.players.find((p) => p.steamId === steamId);
    if (!player || !live.factions.includes(player.faction)) return "Join the configured game server and select a team before registering.";
    const result = await c.query("INSERT INTO seeding_afk_players (discord_id,steam_id,session_id,next_switch_at) VALUES ($1,$2,$3,now()+($4 * interval '1 second')) ON CONFLICT DO NOTHING RETURNING discord_id",
      [input.userId, steamId, s.runtime.sessionId, s.settings.intervalSeconds]);
    if (result.rowCount) await log(c, "registered", input.userId, { steamId, faction: player.faction });
    return result.rowCount ? "You are registered as Seeding AFK. Team moves only happen when safe and balanced; protection ends when seeding finishes." : "You or this game account are already registered.";
  });
}

function embed(s: SeedingSettings): DiscordMessagePayload {
  return { embeds: [{ title: s.title, description: `${s.description}\n\nLinked accounts only. Switch interval: ${s.intervalSeconds}s. You will receive a private in-game reminder every minute. Click I'm back to stop reminders and team switching. Protection stops at ${s.threshold} players. Moves can be skipped for team balance.`, color: 0xeab308 }],
    components: [{ type: 1, components: [
      { type: 2, style: 2, label: "Seeding AFK", emoji: { name: "🌱" }, custom_id: `${SEEDING_BUTTON}:register`, disabled: !s.enabled },
      { type: 2, style: 3, label: "I'm back", emoji: { name: "👋" }, custom_id: `${SEEDING_BUTTON}:back` },
    ] }], allowed_mentions: { parse: [] } };
}
export async function seedingStatus() {
  const [row] = await query<{ settings: SeedingSettings; runtime: Runtime }>("SELECT settings,runtime FROM seeding_afk WHERE id=true");
  return { ...row, registrations: await query<Registration>("SELECT * FROM seeding_afk_players ORDER BY registered_at"), accountLinkRequired: true,
    rconConfigured: !!(env().GAME_RCON_URL && env().GAME_RCON_PASSWORD) };
}
export async function saveSeedingSettings(settings: SeedingSettings, actorId: string) {
  await exclusive(async (c, s) => {
    // Configuration changes revoke existing consent. They cannot unlatch the current session.
    await c.query("DELETE FROM seeding_afk_players");
    s.settings = settings;
    if (!settings.enabled) await terminate(c, s, "Protection disabled");
    await log(c, "settings_changed", actorId, { settings });
  });
  return seedingStatus();
}
export async function publishSeedingEmbed(actorId: string) {
  await exclusive(async (c, s) => {
    if (!s.settings.channelId) throw new Error("Choose a Discord channel first");
    if (s.settings.messageId) await editMessage(s.settings.channelId, s.settings.messageId, embed(s.settings));
    else s.settings.messageId = await postMessage(s.settings.channelId, embed(s.settings));
    await log(c, "embed_published", actorId);
  });
  return seedingStatus();
}

const globalState = globalThis as unknown as { __seedingTimer?: NodeJS.Timeout };
export function startSeedingScheduler() {
  if (process.env.NEXT_PHASE === "phase-production-build" || globalState.__seedingTimer) return;
  const run = () => void seedingTick().catch((e: Error) => console.error("Seeding AFK worker:", e.message));
  // Restart revokes registrations, including when another process is still running.
  void exclusive(async (c, s) => { await c.query("DELETE FROM seeding_afk_players"); await log(c, "registrations_cleared", null, { reason: "Dashboard worker started" }); }).then(run).catch((e: Error) => console.error("Seeding AFK startup:", e.message));
  globalState.__seedingTimer = setInterval(run, 15_000);
  globalState.__seedingTimer.unref();
}
