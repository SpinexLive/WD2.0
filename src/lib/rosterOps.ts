import type { SlotPlayer, Squad } from "./rosterTypes";

export type DropTarget = { kind: "pool" } | { kind: "slot"; squadId: string; index: number } | { kind: "squad"; squadId: string };

export interface PlayerRef {
  discordId: string | null;
  mercenaryId?: string;
  displayName: string;
  avatarUrl: string | null;
}

export const playerKey = (p: PlayerRef) => p.discordId ?? `merc:${p.mercenaryId}`;

export function findPlayer(squads: Squad[], discordId: string): { squadId: string; index: number } | null {
  for (const s of squads) {
    const i = s.slots.findIndex((p) => p && playerKey(p) === discordId);
    if (i >= 0) return { squadId: s.id, index: i };
  }
  return null;
}

/** Moves (or swaps) a player so a Discord user can never occupy two positions. Pure; returns new squads. */
export function movePlayer(squads: Squad[], player: PlayerRef, target: DropTarget): Squad[] {
  const next = squads.map((s) => ({ ...s, slots: [...s.slots] }));
  const from = findPlayer(next, playerKey(player));
  if (from) next.find((s) => s.id === from.squadId)!.slots[from.index] = null;
  if (target.kind === "pool") return next;

  const dest = next.find((s) => s.id === target.squadId);
  if (!dest) return squads;
  // Dropping on a squad (not a specific slot) takes its first empty position; a full squad leaves everything unchanged.
  const index = target.kind === "squad" ? dest.slots.findIndex((p, i) => i < dest.size && !p) : target.index;
  if (index < 0 || index >= dest.size) return squads;
  const occupant = dest.slots[index] ?? null;
  const moved: SlotPlayer = { ...player, isLeader: false };
  dest.slots[index] = moved;
  // Swap with the occupant when the dragged player came from another slot; otherwise the occupant returns to Unassigned.
  if (occupant && from) next.find((s) => s.id === from.squadId)!.slots[from.index] = { ...occupant, isLeader: false };
  return next;
}

export function setLeader(squads: Squad[], squadId: string, discordId: string): Squad[] {
  return squads.map((s) =>
    s.id !== squadId ? s : { ...s, slots: s.slots.map((p) => (p ? { ...p, isLeader: playerKey(p) === discordId ? !p.isLeader : false } : p)) },
  );
}

export function resizeSquad(squad: Squad, size: number): Squad {
  const slots = squad.slots.slice(0, size);
  while (slots.length < size) slots.push(null);
  return { ...squad, size, slots };
}

export function newSquad(name: string, size: number, leaderRequired = false): Squad {
  return { id: `new-${crypto.randomUUID()}`, name, category: name.toUpperCase(), size, leaderRequired, slots: Array.from({ length: size }, () => null) };
}
