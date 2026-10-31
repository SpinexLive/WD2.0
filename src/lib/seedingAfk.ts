import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/);
export const seedingSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  intervalSeconds: z.number().int().min(30).max(3600).default(120),
  threshold: z.number().int().min(2).max(1000).default(20),
  channelId: snowflake.nullable().default(null),
  messageId: snowflake.nullable().default(null),
  title: z.string().trim().min(1).max(256).default("Seeding AFK protection"),
  description: z.string().trim().min(1).max(3000).default("Register while seeding. Protection ends when the player threshold is reached."),
}).strict();
export type SeedingSettings = z.infer<typeof seedingSettingsSchema>;
export interface SeedingPlayer { steamId: string; name: string; faction: string }

/** Always choose another faction, preferring the smallest destination team. */
export function balancedDestination(players: SeedingPlayer[], factions: string[], steamId: string): string | null {
  const player = players.find((p) => p.steamId === steamId);
  if (!player || !factions.includes(player.faction) || factions.length < 2 || new Set(factions).size !== factions.length) return null;
  const counts = new Map(factions.map((f) => [f, players.filter((p) => p.faction === f).length]));
  return factions.filter((f) => f !== player.faction).sort((a, b) => counts.get(a)! - counts.get(b)!)[0] ?? null;
}
