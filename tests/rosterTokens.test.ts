import { describe, expect, it } from "vitest";
import { buildRosterMessages } from "@/server/embed";
import { toggleToken } from "@/lib/rosterOps";
import { tokenByKey } from "@/lib/rosterTokens";
import { saveSchema } from "@/server/services/rosters";
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

  it("defines MAAWs using the existing unlock, icon, and Discord emoji", () => {
    expect(tokenByKey("maaws")).toEqual({
      key: "maaws",
      label: "MAAWs",
      requires: "MAAWs",
      emoji: "<:MAAWs:1566378198751518791>",
      image: "/images/items/loadout/white/MAAWs.webp",
    });
  });

  it("accepts MAAWs alongside the existing icons and shows only its emoji in the roster", () => {
    const assigned = toggleToken(squads(["defib", "sniper", "rockets", "havoc"]), "111111111111111111", "maaws", true);
    expect(saveSchema.safeParse({ version: 1, settings: { warnUnregistered: true }, squads: assigned }).success).toBe(true);
    const messages = buildRosterMessages({ eventTitle: "T", startTime: null, eventType: "weekly", eventUrl: null, squads: assigned });
    const playerLine = messages[0]!.embed.fields[0]!.value;
    expect(playerLine).toContain("Alpha <:Defibrillator:1566378189054410933><:sniper:1388568893206958172><:AH6RRockets:1566378098096734318><:Havoc:1566378102135984260><:MAAWs:1566378198751518791>");
    expect(toggleToken(assigned, "111111111111111111", "maaws", false)[0]!.slots[0]!.tokens).not.toContain("maaws");
  });
});
