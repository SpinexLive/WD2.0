import { describe, expect, it } from "vitest";
import { movePlayer, playerKey, setLeader } from "@/lib/rosterOps";
import { validateRoster } from "@/lib/rosterValidation";
import { saveSchema } from "@/server/services/rosters";
import { buildRosterMessages, STATUS_ICON } from "@/server/embed";
import type { SlotPlayer, Squad } from "@/lib/rosterTypes";

const merc: SlotPlayer = { discordId: null, mercenaryId: "c1ecdb8d-58b2-40d2-8a69-b69a2c291b17", displayName: "Guest *One*", avatarUrl: null, isLeader: false };
const member: SlotPlayer = { discordId: "100000000000000001", displayName: "Member", avatarUrl: null, isLeader: false };
const squad = (id: string, slots: Squad["slots"]): Squad => ({ id, name: id, category: "INFANTRY", size: slots.length, leaderRequired: false, slots });
const settings = { warnUnregistered: true };

describe("named mercenaries", () => {
  it("accepts a name without a Discord ID and rejects blank names or ambiguous identities", () => {
    const input = (player: unknown) => ({ version: 1, settings, squads: [{ ...squad("A", []), size: 1, slots: [player] }] });
    expect(saveSchema.safeParse(input(merc)).success).toBe(true);
    for (const invalid of [
      { ...merc, displayName: "   " }, { ...merc, mercenaryId: undefined },
      { ...merc, discordId: member.discordId }, { ...merc, avatarUrl: "https://cdn.discordapp.com/avatar.png" },
    ]) expect(saveSchema.safeParse(input(invalid)).success).toBe(false);
  });

  it("shows a mercenary without a response icon, ping, or pending confirmation", () => {
    const [message] = buildRosterMessages({ eventTitle: "Match", startTime: null, eventType: "weekly", eventUrl: null, squads: [squad("A", [merc, member, null])] });
    expect(message!.embed.fields[0]!.value.split("\n")).toEqual([
      "☠️ Guest \\*One\\*", `${STATUS_ICON.pending} Member`, "Free Slot - Sign up",
    ]);
    expect(message!.mentions).toEqual([member.discordId]);
    expect(message!.embed.footer?.text).toContain("0 confirmed | 1 pending | 0 declined");
  });

  it("does not require Raid Helper registration for mercenaries but still rejects duplicate assignments", () => {
    const roster = { squads: [squad("A", [merc])], settings, eventType: "competitive" as const };
    expect(validateRoster(roster, [])).toEqual([]);
    expect(validateRoster({ ...roster, squads: [squad("A", [merc, merc])] }, [])).toEqual([expect.objectContaining({ type: "duplicate", severity: "error" })]);
  });

  it("moves, swaps, leads, and removes a mercenary independently of other mercenaries", () => {
    const other = { ...merc, mercenaryId: "1a681d7a-20cd-4e4d-89ae-a26fbd76a04c" };
    const squads = [squad("A", [merc, other]), squad("B", [member])];
    const moved = movePlayer(squads, merc, { kind: "slot", squadId: "B", index: 0 });
    expect(moved[0]!.slots).toEqual([member, other]);
    expect(moved[1]!.slots[0]).toEqual(merc);
    expect(setLeader(moved, "B", playerKey(merc))[1]!.slots[0]!.isLeader).toBe(true);
    const removed = movePlayer(moved, merc, { kind: "pool" });
    expect(removed[1]!.slots[0]).toBeNull();
    expect(removed[0]!.slots[1]).toEqual(other);
    expect(squads[0]!.slots[0]).toEqual(merc);
  });
});
