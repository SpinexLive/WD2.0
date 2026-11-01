import { describe, expect, it } from "vitest";
import { buildRosterMessages } from "@/server/embed";
import { toggleToken } from "@/lib/rosterOps";
import type { Squad } from "@/lib/rosterTypes";

const squads = (tokens?: string[]): Squad[] => [
  { id: "s1", name: "Medics", category: "MEDIC", size: 1, leaderRequired: false, slots: [{ discordId: "111111111111111111", displayName: "Alpha", avatarUrl: null, isLeader: false, ...(tokens ? { tokens } : {}) }] },
];

describe("roster tokens", () => {
  it("shows the sniper and defib emoji beside the player on the published roster", () => {
    const text = JSON.stringify(buildRosterMessages({ eventTitle: "T", startTime: null, eventType: "weekly", eventUrl: null, squads: squads(["sniper", "defib"]) }));
    expect(text).toContain("<:sniper:1388568893206958172>");
    expect(text).toContain("<:Defibrillator:1566378189054410933>");
  });

  it("adds and removes a token without touching other players", () => {
    const on = toggleToken(squads(), "111111111111111111", "havoc", true);
    expect(on[0]!.slots[0]!.tokens).toEqual(["havoc"]);
    expect(toggleToken(on, "111111111111111111", "havoc", false)[0]!.slots[0]!.tokens).toEqual([]);
  });
});
