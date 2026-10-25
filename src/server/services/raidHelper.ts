import { env } from "@/lib/env";
import { requestJson, ProviderError } from "@/lib/http";
import { cached, type Snapshot } from "@/lib/cache";

/*
 * Raid Helper's public documentation (https://raid-helper.dev/documentation/api) is a client-rendered app and could not
 * be machine-read when this integration was written, so the endpoint paths below are configurable via env
 * (RAID_HELPER_EVENTS_PATH / RAID_HELPER_EVENT_PATH) and responses are validated defensively. Confirm them against the
 * documentation before relying on the integration; see README.
 */

export interface RaidHelperEvent {
  id: string;
  title: string;
  /** Unix seconds, or null when the API did not provide a usable start time. */
  startTime: number | null;
  signupCount: number | null;
  status: "upcoming" | "past" | "closed" | "unknown";
  channelId: string | null;
  discordUrl: string | null;
}

export interface RaidHelperSignup {
  discordId: string;
  name: string;
  role: string | null;
  status: string | null;
  absent: boolean;
}

export interface RaidHelperEventDetail extends RaidHelperEvent {
  signups: RaidHelperSignup[];
}

const headers = () => ({ Authorization: env().RAID_HELPER_API_TOKEN });
const url = (template: string, vars: Record<string, string>) =>
  env().RAID_HELPER_BASE_URL + template.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(vars[k] ?? ""));

const asObj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const asStr = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" && Number.isSafeInteger(v) ? String(v) : null);
const asSnowflake = (v: unknown): string | null => (typeof v === "string" && /^\d{15,22}$/.test(v) ? v : null);

/** Expands Raid Helper date placeholders such as {eventtime#EEEE, dd. MMMM} ("Tuesday, 27. October") using the event start time. */
export function formatTitle(title: string, startTime: number | null): string {
  if (startTime === null) return title;
  const date = new Date(startTime * 1000);
  const part = (opts: Intl.DateTimeFormatOptions, type: Intl.DateTimeFormatPartTypes) =>
    new Intl.DateTimeFormat("en-GB", opts).formatToParts(date).find((p) => p.type === type)?.value ?? "";
  const tokens: Record<string, () => string> = {
    EEEE: () => part({ weekday: "long" }, "weekday"),
    EEE: () => part({ weekday: "short" }, "weekday"),
    dd: () => part({ day: "2-digit" }, "day"),
    d: () => String(Number(part({ day: "numeric" }, "day"))),
    MMMM: () => part({ month: "long" }, "month"),
    MMM: () => part({ month: "short" }, "month"),
    MM: () => part({ month: "2-digit" }, "month"),
    yyyy: () => part({ year: "numeric" }, "year"),
    HH: () => part({ hour: "2-digit", hourCycle: "h23" }, "hour"),
    mm: () => part({ minute: "2-digit" }, "minute"),
  };
  return title.replace(/\{eventtime#([^}]*)\}/gi, (_, fmt: string) =>
    fmt.replace(/EEEE|EEE|dd|d|MMMM|MMM|MM|yyyy|HH|mm/g, (t) => tokens[t]!()),
  );
}

export function parseEvent(raw: unknown): RaidHelperEvent | null {
  const o = asObj(raw);
  if (!o) return null;
  const id = asStr(o.id) ?? asStr(o.eventId) ?? asStr(o.messageId);
  if (!id) return null;
  const startRaw = o.startTime ?? o.unixtime ?? o.startUnix;
  const startTime = typeof startRaw === "number" && Number.isFinite(startRaw) ? Math.floor(startRaw > 1e11 ? startRaw / 1000 : startRaw) : null;
  const signups = Array.isArray(o.signUps) ? o.signUps : Array.isArray(o.signups) ? o.signups : null;
  const countRaw = o.signUpCount ?? o.signupCount ?? o.signUps_count;
  const closed = o.closed === true || o.isClosed === true || asStr(o.closingTime) === "closed";
  const channelId = asSnowflake(o.channelId) ?? asSnowflake(o.channelID);
  const guild = env().DISCORD_GUILD_ID;
  return {
    id,
    title: formatTitle(asStr(o.title) ?? asStr(o.displayTitle) ?? `Event ${id}`, startTime),
    startTime,
    signupCount: typeof countRaw === "number" ? countRaw : countRaw !== undefined && Number.isFinite(Number(countRaw)) ? Number(countRaw) : (signups?.length ?? null),
    status: closed ? "closed" : startTime === null ? "unknown" : startTime * 1000 < Date.now() ? "past" : "upcoming",
    channelId,
    // Raid Helper event IDs are the Discord message IDs of the event post.
    discordUrl: channelId && /^\d+$/.test(id) ? `https://discord.com/channels/${guild}/${channelId}/${id}` : null,
  };
}

export function parseSignups(raw: unknown): RaidHelperSignup[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const o = asObj(r);
    const discordId = o && asSnowflake(o.userId ?? o.userid ?? o.discordId);
    if (!o || !discordId) return [];
    const role = asStr(o.cClassName) ?? asStr(o.className) ?? asStr(o.specName) ?? asStr(o.role);
    const status = asStr(o.status);
    const text = `${role ?? ""} ${status ?? ""}`.toLowerCase();
    return [{ discordId, name: asStr(o.name) ?? discordId, role, status, absent: text.includes("absence") || text.includes("absent") || text.includes("declin") }];
  });
}

export function getEvents(force = false): Promise<Snapshot<RaidHelperEvent[]>> {
  return cached("rh:events", 60_000, async () => {
    const events: RaidHelperEvent[] = [];
    let pages = 1;
    for (let page = 1; page <= Math.min(pages, 5); page++) {
      const { data } = await requestJson({
        provider: "raid-helper",
        url: `${url(env().RAID_HELPER_EVENTS_PATH, { guildId: env().DISCORD_GUILD_ID })}?page=${page}`,
        headers: headers(),
      });
      const o = asObj(data);
      const list = Array.isArray(data) ? data : (o && [o.postedEvents, o.events, o.data].find(Array.isArray)) ;
      if (!Array.isArray(list)) throw new ProviderError("raid-helper", "Unrecognised Raid Helper events response format");
      for (const item of list) {
        const e = parseEvent(item);
        if (e) events.push(e);
      }
      if (o && typeof o.pages === "number") pages = o.pages;
    }
    return events.sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
  }, force);
}

export function getEventDetail(eventId: string, force = false): Promise<Snapshot<RaidHelperEventDetail>> {
  if (!/^[\w-]{1,64}$/.test(eventId)) throw new ProviderError("raid-helper", "Invalid event id");
  return cached(`rh:event:${eventId}`, 30_000, async () => {
    const { data } = await requestJson({ provider: "raid-helper", url: url(env().RAID_HELPER_EVENT_PATH, { eventId }), headers: headers() });
    const event = parseEvent(data);
    if (!event) throw new ProviderError("raid-helper", "Unrecognised Raid Helper event response format");
    const o = asObj(data)!;
    return { ...event, signups: parseSignups(o.signUps ?? o.signups) };
  }, force);
}
