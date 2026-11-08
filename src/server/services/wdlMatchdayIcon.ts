import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { env } from "@/lib/env";
import { query } from "@/lib/db";
import { requestJson } from "@/lib/http";
import type { WdlFixture, WdlFixtures } from "@/lib/wdlFixtures";
import { getLeagueFixtures } from "./wardogsLeague";

const API = "https://discord.com/api/v10";
const TIME_ZONE = "Europe/London";
const MATCHDAY_MS = 60 * 60 * 1000;
const CANCELLED_STATUSES = new Set(["CANCELLED", "CANCELED", "POSTPONED", "ABANDONED", "VOID"]);
type IconVariant = "matchday" | "default";

function londonParts(timestamp: number): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp).map(({ type, value }) => [type, value]));
}

function matchdayDate(timestamp: number): string {
  const parts = londonParts(timestamp);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Match-day starts at 01:00 London time and lasts until one hour after each RMNT match starts. */
export function isWdlMatchdayIconActive(fixtures: WdlFixtures, now = Date.now()): boolean {
  const currentParts = londonParts(now);
  const currentDate = `${currentParts.year}-${currentParts.month}-${currentParts.day}`;
  const currentHour = Number(currentParts.hour);

  return [...fixtures.upcoming, ...fixtures.recent].some((fixture: WdlFixture) => {
    const scheduledAt = fixture.scheduledAt ? Date.parse(fixture.scheduledAt) : NaN;
    if (!Number.isFinite(scheduledAt) || CANCELLED_STATUSES.has(fixture.status.toUpperCase())) return false;
    if (!fixture.participants.some((participant) => participant.team.code?.trim().toUpperCase() === "RMNT")) return false;

    const date = matchdayDate(scheduledAt);
    const matchdayStarted = currentDate > date || (currentDate === date && currentHour >= 1);
    return matchdayStarted && now < scheduledAt + MATCHDAY_MS;
  });
}

function botHeaders() {
  return { Authorization: `Bot ${env().DISCORD_BOT_TOKEN}` };
}

async function updateServerIcon(variant: IconVariant): Promise<void> {
  const relativePath = variant === "matchday"
    ? ["public", "images", "calendar logos", "matchday.png"]
    : ["public", "images", "icon.png"];
  const image = await readFile(resolve(process.cwd(), ...relativePath));
  const body = `data:image/png;base64,${image.toString("base64")}`;
  await requestJson({
    provider: "discord",
    method: "PATCH",
    url: `${API}/guilds/${env().DISCORD_GUILD_ID}`,
    headers: botHeaders(),
    body: { icon: body },
    retries: 0,
  });
}

async function recordError(previous: string | null, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "Unknown matchday icon error";
  await query("UPDATE wdl_matchday_icon_state SET last_error = $1 WHERE id = 1", [message.slice(0, 500)]);
  if (previous !== message) console.error("WDL matchday server icon:", message);
}

export async function syncWdlMatchdayIcon(now = Date.now()): Promise<void> {
  const [state] = await query<{ current_icon: IconVariant | null; last_error: string | null }>(
    "SELECT current_icon, last_error FROM wdl_matchday_icon_state WHERE id = 1",
  );
  if (!state) throw new Error("WDL matchday icon migration has not been applied.");

  let snapshot: Awaited<ReturnType<typeof getLeagueFixtures>>;
  try {
    snapshot = await getLeagueFixtures();
  } catch (error) {
    await recordError(state.last_error, error);
    return;
  }
  if (snapshot.stale) {
    await recordError(state.last_error, new Error(snapshot.error ?? "WDL fixtures are stale."));
    return;
  }

  const desired: IconVariant = isWdlMatchdayIconActive(snapshot.data, now) ? "matchday" : "default";
  if (state.current_icon === desired || (desired === "default" && state.current_icon === null)) {
    if (state.last_error) await query("UPDATE wdl_matchday_icon_state SET last_error = NULL WHERE id = 1");
    return;
  }

  try {
    await updateServerIcon(desired);
  } catch (error) {
    await recordError(state.last_error, error);
    return;
  }
  await query("UPDATE wdl_matchday_icon_state SET current_icon = $1, last_error = NULL, updated_at = now() WHERE id = 1", [desired]);
}

const g = globalThis as unknown as { __wdlMatchdayIconTimer?: NodeJS.Timeout };

export function startWdlMatchdayIconScheduler(): void {
  if (process.env.NEXT_PHASE === "phase-production-build" || g.__wdlMatchdayIconTimer) return;
  const run = () => void syncWdlMatchdayIcon().catch((error: Error) => console.error("WDL matchday icon:", error.message));
  run();
  g.__wdlMatchdayIconTimer = setInterval(run, 60_000);
  g.__wdlMatchdayIconTimer.unref();
}
