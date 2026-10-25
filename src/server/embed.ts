import type { RosterResponse, Squad } from "@/lib/rosterTypes";

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color: number;
  fields: { name: string; value: string; inline: false }[];
  footer?: { text: string };
  timestamp?: string;
}

export interface EmbedInput {
  eventTitle: string;
  startTime: number | null;
  /** The Raid Helper event description, shown above the date. */
  eventDescription?: string | null;
  eventType: "competitive" | "weekly";
  eventUrl: string | null;
  squads: Squad[];
  /** Discord ID -> response; assigned players missing from the map are pending. */
  responses?: Record<string, RosterResponse>;
  now?: Date;
}

export interface RosterMessage {
  embed: DiscordEmbed;
  /** Everyone listed in this message; they are always mentioned. */
  mentions: string[];
}

export const RED = 0xa31919;
export const STATUS_ICON = {
  accepted: "<:yes:1389367850082500729>",
  declined: "<:no:1389367851470553108>",
  pending: "<:pending:1397222095770878069>",
} as const;
const MAX_FIELDS = 25;
/** Discord allows 6000 characters per message across all embeds; keep headroom. */
const MAX_EMBED_CHARS = 5500;
const MAX_FIELD_VALUE = 1024;
const MAX_FIELD_NAME = 256;
const MAX_CONTENT = 2000;

const escapeMd = (s: string) => s.replace(/[\\*_~`|>[\]()#]/g, "\\$&").replace(/@/g, "@\u200b");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

type Field = { name: string; value: string; inline: false; ids: string[] };

function playerLine(p: NonNullable<Squad["slots"][number]>, responses: Record<string, RosterResponse>): string {
  const who = `<@${p.discordId}>`;
  return `${STATUS_ICON[responses[p.discordId] ?? "pending"]} ${p.isLeader ? `**${who}** ★` : who}`;
}

function squadPlayers(s: Squad) {
  const filled = s.slots.filter((p): p is NonNullable<typeof p> => p !== null);
  // Leader first, then slot order.
  return [...filled.filter((p) => p.isLeader), ...filled.filter((p) => !p.isLeader)];
}

function fieldsFor(squads: Squad[], responses: Record<string, RosterResponse>): Field[] {
  const order: string[] = [];
  for (const s of squads) if (!order.includes(s.category)) order.push(s.category);
  const out: Field[] = [];
  for (const category of order) {
    for (const s of squads.filter((x) => x.category === category)) {
      const base = clip(s.name.toUpperCase() === category.toUpperCase() ? category.toUpperCase() : `${category.toUpperCase()} • ${s.name}`, MAX_FIELD_NAME - 8);
      const players = squadPlayers(s);
      if (players.length === 0) {
        out.push({ name: base, value: "—", inline: false, ids: [] });
        continue;
      }
      // Chunks stay under the field limit; each carries the players it lists.
      let value = "";
      let ids: string[] = [];
      let part = 0;
      const flush = () => {
        out.push({ name: part === 0 ? base : `${base} (cont.)`, value, inline: false, ids });
        part++;
        value = "";
        ids = [];
      };
      for (const p of players) {
        const line = playerLine(p, responses);
        if (value && value.length + 1 + line.length > MAX_FIELD_VALUE) flush();
        value = value ? `${value}\n${line}` : line;
        ids.push(p.discordId);
      }
      flush();
    }
  }
  return out;
}

const embedSize = (e: DiscordEmbed) =>
  (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0) + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);

/**
 * Builds one message per Discord post. Output is split automatically so every message respects the
 * 25 field / 6000 character limits.
 */
export function buildRosterMessages(input: EmbedInput): RosterMessage[] {
  const responses = input.responses ?? {};
  const title = clip(input.eventTitle, 240);
  const lines: string[] = [];
  if (input.eventDescription) lines.push(clip(input.eventDescription, 1500), "");
  if (input.startTime) lines.push(`**Date:** <t:${input.startTime}:D>`, `**Time:** <t:${input.startTime}:t>`);
  const description = lines.join("\n").trim();

  const fields = fieldsFor(input.squads, responses);
  const groups: Field[][] = [];
  let current: Field[] = [];
  let size = 0;
  const reserved = description.length + 160;
  for (const f of fields) {
    const fs = f.name.length + f.value.length;
    if (current.length > 0 && (current.length >= MAX_FIELDS || size + fs + reserved > MAX_EMBED_CHARS)) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(f);
    size += fs;
  }
  groups.push(current);

  const everyone = input.squads.flatMap((s) => s.slots.flatMap((p) => (p ? [p.discordId] : [])));
  const confirmed = everyone.filter((id) => responses[id] === "accepted").length;
  const declined = everyone.filter((id) => responses[id] === "declined").length;
  const counts = `${confirmed} confirmed | ${everyone.length - confirmed - declined} pending | ${declined} declined`;

  const timestamp = (input.now ?? new Date()).toISOString();
  return groups.map((g, i) => ({
    mentions: g.flatMap((f) => f.ids),
    embed: {
      title: i === 0 ? title : `${title} (continued)`,
      description: i === 0 && description ? description : undefined,
      color: RED,
      fields: g.map(({ name, value, inline }) => ({ name, value, inline })),
      footer: { text: groups.length > 1 ? `${counts} | Part ${i + 1}/${groups.length}` : counts },
      timestamp,
    },
  }));
}

export function buildRosterEmbeds(input: EmbedInput): DiscordEmbed[] {
  return buildRosterMessages(input).map((m) => m.embed);
}

/** Message text that pings everyone listed in the message. Discord caps `content` at 2000 characters. */
export function mentionContent(mentions: string[], first: boolean): string | undefined {
  if (mentions.length === 0) return undefined;
  let out = first ? "Roster posted for confirmation: " : "";
  for (const id of mentions) {
    const m = `<@${id}> `;
    if (out.length + m.length > MAX_CONTENT) break;
    out += m;
  }
  return out.trimEnd();
}

export { embedSize };
