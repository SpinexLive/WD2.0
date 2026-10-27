import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { getClanMembers, postMessage } from "./discord";
import { getEvents } from "./raidHelper";
import { getMatches } from "./wardogsRcon";
import { getLeagueMembers } from "./wardogsLeague";
import { kickMatchSync, matchSyncStatus } from "./matchHistory";
import { gatewayReady } from "./rosterGateway";
import { snapshotAttendance } from "./attendance";

const ALERT_AFTER_MS = 60 * 60_000;
const HEALTH_TTL_MS = 60_000;

export interface Component {
  key: string;
  label: string;
  ok: boolean;
  detail: string | null;
  failingSince: string | null;
}

interface MonitorState {
  failingSince: Map<string, number>;
  alerted: Set<string>;
  last?: { at: number; components: Component[] };
  timer?: NodeJS.Timeout;
  ticks: number;
}
const g = globalThis as unknown as { __monitor?: MonitorState };
const state = (): MonitorState => (g.__monitor ??= { failingSince: new Map(), alerted: new Set(), ticks: 0 });

type Result = { ok: boolean; detail: string | null };
const fromSnapshot = (s: { stale: boolean; error?: string }): Result => (s.stale ? { ok: false, detail: s.error ?? "Using the last good data; the provider isn't answering." } : { ok: true, detail: null });
const attempt = async (fn: () => Promise<Result>): Promise<Result> => {
  try {
    return await fn();
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "Unknown error" };
  }
};

/** Runs every integration check. Results are cached for a minute and track how long each component has been failing. */
export async function getHealth(force = false): Promise<Component[]> {
  const s = state();
  if (!force && s.last && Date.now() - s.last.at < HEALTH_TTL_MS) return s.last.components;
  const checks: [string, string, () => Promise<Result>][] = [
    ["database", "Database", async () => (await query("SELECT 1"), { ok: true, detail: null })],
    ["discord", "Discord API", async () => fromSnapshot(await getClanMembers())],
    ["gateway", "Discord bot connection", async () => (gatewayReady() ? { ok: true, detail: null } : { ok: false, detail: "The bot isn't connected to the Discord gateway (buttons, voice presence and attendance are affected)." })],
    ["raid-helper", "Raid Helper", async () => fromSnapshot(await getEvents())],
    ["wardogs-rcon", "Wardogs RCON API", async () => fromSnapshot(await getMatches())],
    ["wardogs-league", "Wardogs League API", async () => fromSnapshot(await getLeagueMembers())],
    [
      "match-sync",
      "Match history sync",
      async () => {
        const m = matchSyncStatus();
        return m.failed ? { ok: false, detail: m.error } : { ok: true, detail: m.error };
      },
    ],
    [
      "gold",
      "Gold price channel",
      async () => {
        const [row] = await query<{ last_error: string | null }>("SELECT last_error FROM gold_channel");
        return row?.last_error ? { ok: false, detail: row.last_error } : { ok: true, detail: row ? null : "Not set up" };
      },
    ],
  ];
  const results = await Promise.all(checks.map(async ([key, label, fn]) => ({ key, label, ...(await attempt(fn)) })));
  const now = Date.now();
  const components = results.map<Component>((r) => {
    if (r.ok) s.failingSince.delete(r.key);
    else if (!s.failingSince.has(r.key)) s.failingSince.set(r.key, now);
    const since = s.failingSince.get(r.key);
    return { ...r, failingSince: since ? new Date(since).toISOString() : null };
  });
  s.last = { at: now, components };
  return components;
}

async function sendAlert(content: string) {
  const channelId = env().ALERT_CHANNEL_ID;
  if (!channelId) return;
  try {
    await postMessage(channelId, { content, embeds: [], allowed_mentions: { parse: [] } });
  } catch (err) {
    console.error("alert post failed:", err instanceof Error ? err.message : "unknown");
  }
}

/** One alert when a component has been failing for an hour, and one when it recovers. */
async function checkAlerts() {
  const s = state();
  const components = await getHealth(true);
  for (const c of components) {
    const since = s.failingSince.get(c.key);
    if (!c.ok && since && Date.now() - since >= ALERT_AFTER_MS && !s.alerted.has(c.key)) {
      s.alerted.add(c.key);
      await sendAlert(`⚠️ **${c.label}** has been failing since <t:${Math.floor(since / 1000)}:R>.\n${c.detail ?? ""}`.trim());
    } else if (c.ok && s.alerted.has(c.key)) {
      s.alerted.delete(c.key);
      await sendAlert(`✅ **${c.label}** is working again.`);
    }
  }
}

/** Every minute: record attendance for events that just started. Every 5 minutes: keep match history syncing and run the health checks and alerts. */
export function startMonitor(): void {
  const s = state();
  if (process.env.NEXT_PHASE === "phase-production-build" || s.timer) return;
  const tick = async () => {
    s.ticks++;
    await snapshotAttendance().catch((e: Error) => console.error("attendance snapshot failed:", e.message));
    if (s.ticks % 5 === 1) {
      kickMatchSync();
      await checkAlerts().catch((e: Error) => console.error("health check failed:", e.message));
    }
  };
  s.timer = setInterval(() => void tick(), 60_000);
  s.timer.unref?.();
  setTimeout(() => void tick(), 20_000).unref?.();
}
