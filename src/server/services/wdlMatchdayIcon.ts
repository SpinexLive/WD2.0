import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { env } from "@/lib/env";
import { query } from "@/lib/db";
import { requestJson } from "@/lib/http";
import type { WdlFixture, WdlFixtures } from "@/lib/wdlFixtures";
import { CALENDAR_TIME_ZONE, HOLIDAY_LOGOS, londonDate, type CalendarIconVariant } from "@/lib/calendarLogos";
import { getLeagueFixtures } from "./wardogsLeague";
import { getGwlFixtures, type GwlFixture } from "./gwl";

const API = "https://discord.com/api/v10";
const MATCHDAY_MS = 60 * 60 * 1000;
const CANCELLED_STATUSES = new Set(["CANCELLED", "CANCELED", "POSTPONED", "ABANDONED", "VOID"]);

/** Match-day starts at 01:00 London time and lasts until one hour after each RMNT match starts. */
export function isWdlMatchdayIconActive(fixtures: WdlFixtures, now = Date.now()): boolean {
  const starts = [...fixtures.upcoming, ...fixtures.recent].flatMap((fixture: WdlFixture) => {
    const scheduledAt = fixture.scheduledAt ? Date.parse(fixture.scheduledAt) : NaN;
    if (!Number.isFinite(scheduledAt) || CANCELLED_STATUSES.has(fixture.status.toUpperCase())) return [];
    if (!fixture.participants.some((participant) => participant.team.code?.trim().toUpperCase() === "RMNT")) return [];
    return [scheduledAt];
  });
  return isMatchdayActive(starts, now);
}

export function isGwlMatchdayIconActive(fixtures: { upcoming: GwlFixture[]; recent: GwlFixture[] }, now = Date.now()): boolean {
  return isMatchdayActive([...fixtures.upcoming, ...fixtures.recent].flatMap((fixture) => {
    if (CANCELLED_STATUSES.has(fixture.status.toUpperCase())) return [];
    return [Date.parse(fixture.startsAt)];
  }), now);
}

function isMatchdayActive(times: number[], now: number): boolean {
  const nowParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CALENDAR_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const currentHour = Number(nowParts.find((part) => part.type === "hour")?.value);
  const currentDate = londonDate(now);
  const starts = times.filter(Number.isFinite).map((scheduledAt) => ({ date: londonDate(scheduledAt), scheduledAt }));
  const dates = new Set(starts.map((match) => match.date));
  return [...dates].some((date) => {
    const latestStart = Math.max(...starts.filter((match) => match.date === date).map((match) => match.scheduledAt));
    const matchdayStarted = currentDate > date || (currentDate === date && currentHour >= 1);
    return matchdayStarted && now < latestStart + MATCHDAY_MS;
  });
}

export function getCalendarIconVariant(fixtures: WdlFixtures, now = Date.now(), gwlMatchdayActive = false): CalendarIconVariant {
  const today = londonDate(now);
  const activeHoliday = HOLIDAY_LOGOS.find((logo) => today >= logo.startDate && today <= logo.endDate);
  const matchdayActive = isWdlMatchdayIconActive(fixtures, now) || gwlMatchdayActive;
  if (activeHoliday) {
    const isSingleDay = activeHoliday.startDate === activeHoliday.endDate;
    if (isSingleDay || !matchdayActive) return activeHoliday.key;
    return "matchday";
  }
  return matchdayActive ? "matchday" : "default";
}

function botHeaders() {
  return { Authorization: `Bot ${env().DISCORD_BOT_TOKEN}` };
}

async function updateServerIcon(variant: CalendarIconVariant): Promise<void> {
  let imagePath: string[];
  if (variant === "default") {
    imagePath = ["public", "images", "icon.png"];
  } else if (variant === "matchday") {
    imagePath = ["public", "images", "calendar logos", "matchday.png"];
  } else {
    const logo = HOLIDAY_LOGOS.find((item) => item.key === variant);
    if (!logo) throw new Error(`Unknown calendar icon variant: ${variant}`);
    imagePath = ["public", ...logo.image.slice(1).split("/")];
  }
  const body = `data:image/png;base64,${(await readFile(resolve(process.cwd(), ...imagePath))).toString("base64")}`;
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
  const [state] = await query<{ current_icon: CalendarIconVariant | null; last_error: string | null }>(
    "SELECT current_icon, last_error FROM wdl_matchday_icon_state WHERE id = 1",
  );
  if (!state) throw new Error("WDL matchday icon migration has not been applied.");

  let snapshot: Awaited<ReturnType<typeof getLeagueFixtures>>;
  let gwlMatchday = false;
  try {
    snapshot = await getLeagueFixtures();
    if (env().GWL_API_KEY) {
      const gwl = await getGwlFixtures();
      if (gwl.stale) throw new Error(gwl.error ?? "GWL fixtures are stale.");
      gwlMatchday = isGwlMatchdayIconActive(gwl.data, now);
    }
  } catch (error) {
    await recordError(state.last_error, error);
    return;
  }
  if (snapshot.stale) {
    await recordError(state.last_error, new Error(snapshot.error ?? "WDL fixtures are stale."));
    return;
  }

  const desired = getCalendarIconVariant(snapshot.data, now, gwlMatchday);
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
