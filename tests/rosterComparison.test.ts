import { describe, expect, it } from "vitest";
import { selectedSquadComparisons, squadAverageKd, squadHasMissingKd } from "@/lib/rosterComparison";
import { movePlayer } from "@/lib/rosterOps";
import { saveSchema } from "@/server/services/rosters";
import type { SlotPlayer, Squad } from "@/lib/rosterTypes";

const player = (id: string): SlotPlayer => ({ discordId: id, displayName: id, avatarUrl: null, isLeader: false });
const guest: SlotPlayer = { discordId: null, mercenaryId: "c1ecdb8d-58b2-40d2-8a69-b69a2c291b17", displayName: "Merc", avatarUrl: null, isLeader: false };
const squad = (id: string, slots: Squad["slots"], compareKd = true): Squad => ({
  id, name: id, category: "INFANTRY", size: slots.length, leaderRequired: false, compareKd, slots,
});
const idA = "100000000000000001";
const idB = "100000000000000002";
const stats = new Map<string, number | null>([[idA, 1.8], [idB, 1.2]]);

describe("squad K/D comparison", () => {
  it("averages only placed players, never empty slots or unassigned players", () => {
    const partial = squad("Alpha", [player(idA), null, null, null]);
    expect(squadAverageKd(partial, stats)).toBe(1.8);
    expect(squadHasMissingKd(partial, stats)).toBe(false);
    expect(squadAverageKd(squad("Empty", [null, null]), stats)).toBeNull();
    expect(squadHasMissingKd(squad("Empty", [null, null]), stats)).toBe(false);
  });

  it("includes a genuine zero K/D and excludes missing and mercenary stats", () => {
    const mixed = squad("Alpha", [player(idA), player(idB), player("missing"), guest, null]);
    expect(squadAverageKd(mixed, new Map([[idA, 2], [idB, 0]]))).toBe(1);
    expect(squadHasMissingKd(mixed, new Map([[idA, 2], [idB, 0]]))).toBe(true);
    expect(squadAverageKd(squad("Unknown", [player("missing"), guest]), stats)).toBeNull();
    expect(squadAverageKd(squad("Bad", [player(idA)]), new Map([[idA, NaN]]))).toBeNull();
  });

  it("lists only selected squads, separately, and changes immediately when players move", () => {
    const a = squad("Alpha", [player(idA), null]);
    const b = squad("Bravo", [player(idB), null]);
    const c = squad("Hidden", [player("unknown")], false);
    const before = selectedSquadComparisons([a, b, c], stats);
    expect(before.map(({ name, kd }) => ({ name, kd }))).toEqual([{ name: "Alpha", kd: 1.8 }, { name: "Bravo", kd: 1.2 }]);
    const moved = movePlayer([a, b, c], player(idB), { kind: "slot", squadId: "Alpha", index: 1 });
    const after = selectedSquadComparisons(moved, stats);
    expect(after[0]!.kd).toBe(1.5);
    expect(after[1]!.kd).toBeNull();
    expect(after[1]!.missing).toBe(false);
  });

  it("accepts saved comparison flags and remains compatible with existing clients", () => {
    const input = { version: 1, settings: { warnUnregistered: true }, squads: [squad("Alpha", [null])] };
    expect(saveSchema.parse(input).squads[0]!.compareKd).toBe(true);
    const { compareKd: _compareKd, ...oldSquad } = input.squads[0]!;
    expect(saveSchema.safeParse({ ...input, squads: [oldSquad] }).success).toBe(true);
    expect(saveSchema.safeParse({ ...input, squads: [{ ...oldSquad, compareKd: "yes" }] }).success).toBe(false);
  });
});
