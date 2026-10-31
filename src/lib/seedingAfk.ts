import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/);
export const seedingSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  intervalSeconds: z.number().int().min(30).max(3600).default(120),
  threshold: z.number().int().min(2).max(1000).default(20),
  channelId: snowflake.nullable().default(null),
  messageId: snowflake.nullable().default(null),
  title: z.string().trim().min(1).max(256).default("Seeding AFK protection"),
  description: z.string().trim().min(1).max(3000).default("Register while seeding. Protection ends when the player threshold is reached or the match starts."),
}).strict();
export type SeedingSettings = z.infer<typeof seedingSettingsSchema>;
export interface SeedingPlayer { steamId: string; name: string; faction: string }
export const isSeedingState = (state?: string) => /^MatchState\.PreMatch\.WaitingForPlayers(?:\.PlayerCount)?$/.test(state ?? "");

/** Never worsen the existing spread; require the resulting teams to be within one. */
export function balancedDestination(players: SeedingPlayer[], factions: string[], steamId: string, limit = 1): string | null {
  const player = players.find((p) => p.steamId === steamId);
  if (!player || !factions.includes(player.faction) || factions.length < 2 || new Set(factions).size !== factions.length) return null;
  if (players.some((p) => !factions.includes(p.faction))) return null;
  const counts = factions.map((f) => players.filter((p) => p.faction === f).length);
  const spread = Math.max(...counts) - Math.min(...counts);
  const source = factions.indexOf(player.faction);
  for (const target of factions.map((f, i) => ({ f, i })).filter(({ i }) => i !== source).sort((a, b) => counts[a.i]! - counts[b.i]!)) {
    const after = counts.map((n, i) => n + (i === source ? -1 : i === target.i ? 1 : 0));
    const difference = Math.max(...after) - Math.min(...after);
    if (difference <= Math.min(1, limit) && difference <= spread) return target.f;
  }
  return null;
}
