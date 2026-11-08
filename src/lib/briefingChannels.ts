import { CALENDAR_TIME_ZONE, londonDate } from "@/lib/calendarLogos";

export const BRIEFING_CHANNEL_PREFIX = "🔊┊";

const SMALL_CAPS: Record<string, string> = {
  a: "ᴀ", b: "ʙ", c: "ᴄ", d: "ᴅ", e: "ᴇ", f: "ꜰ", g: "ɢ", h: "ʜ", i: "ɪ",
  j: "ᴊ", k: "ᴋ", l: "ʟ", m: "ᴍ", n: "ɴ", o: "ᴏ", p: "ᴘ", q: "ǫ", r: "ʀ",
  s: "ꜱ", t: "ᴛ", u: "ᴜ", v: "ᴠ", w: "ᴡ", x: "x", y: "ʏ", z: "ᴢ",
};

export function formatBriefingChannelName(name: string): string {
  const base = name.trim().replace(/^🔊┊/u, "").toLowerCase()
    .replace(/[^\p{L}\p{N}-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
  return base ? `${BRIEFING_CHANNEL_PREFIX}${Array.from(base, (char) => SMALL_CAPS[char] ?? char).join("")}` : "";
}

export function nextLondonMidnight(timestamp: number): Date {
  const dateParts = londonDate(timestamp).split("-").map(Number);
  if (dateParts.length !== 3 || !dateParts.every(Number.isFinite)) throw new Error("Could not determine the London calendar date.");
  const year = dateParts[0] ?? NaN;
  const month = dateParts[1] ?? NaN;
  const day = dateParts[2] ?? NaN;
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
  const targetUtc = Date.UTC(nextDate.getUTCFullYear(), nextDate.getUTCMonth(), nextDate.getUTCDate());
  let guess = targetUtc;

  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: CALENDAR_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(guess);
    const part = (type: string) => {
      const value = parts.find((item) => item.type === type)?.value;
      if (!value) throw new Error(`Could not resolve London midnight (${type}).`);
      return Number(value);
    };
    const localAsUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
    guess += targetUtc - localAsUtc;
  }

  return new Date(guess);
}

export interface DiscordRolePermission {
  id: string;
  permissions: string;
}

export function buildBriefingChannelOverwrites(guildId: string, clanRoleId: string, botId: string, roles: DiscordRolePermission[]) {
  const viewChannel = 1n << 10n;
  const connect = 1n << 20n;
  const roleOverwrites = roles.flatMap((role) => {
    if (role.id === guildId || role.id === clanRoleId) return [];
    if ((BigInt(role.permissions) & viewChannel) === 0n) return [];
    return [{ id: role.id, type: 0, allow: "0", deny: String(viewChannel) }];
  });
  return [
    { id: guildId, type: 0, allow: "0", deny: String(viewChannel) },
    ...roleOverwrites,
    { id: clanRoleId, type: 0, allow: String(viewChannel | connect), deny: "0" },
    { id: botId, type: 1, allow: String(viewChannel | connect), deny: "0" },
  ];
}
