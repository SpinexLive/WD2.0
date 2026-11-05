import type { Squad } from "./rosterTypes";

/** Average the known K/Ds of placed players only; an empty or unknown squad has no average. */
export function squadAverageKd(squad: Squad, kdByDiscordId: ReadonlyMap<string, number | null>): number | null {
  const values = squad.slots.flatMap((player) => {
    if (!player?.discordId) return [];
    const kd = kdByDiscordId.get(player.discordId);
    return typeof kd === "number" && Number.isFinite(kd) && kd >= 0 ? [kd] : [];
  });
  return values.length ? values.reduce((sum, kd) => sum + kd, 0) / values.length : null;
}

export function squadHasMissingKd(squad: Squad, kdByDiscordId: ReadonlyMap<string, number | null>): boolean {
  return squad.slots.some((player) => {
    if (!player) return false;
    if (!player.discordId) return true;
    const kd = kdByDiscordId.get(player.discordId);
    return typeof kd !== "number" || !Number.isFinite(kd) || kd < 0;
  });
}

export function selectedSquadComparisons(squads: Squad[], kdByDiscordId: ReadonlyMap<string, number | null>) {
  return squads.filter((squad) => squad.compareKd).map((squad) => ({
    id: squad.id,
    name: squad.name,
    kd: squadAverageKd(squad, kdByDiscordId),
    missing: squadHasMissingKd(squad, kdByDiscordId),
  }));
}
