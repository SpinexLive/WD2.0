import { describe, expect, it } from "vitest";
import { parseTeams, teamKey } from "../src/lib/scouting";

describe("scouting team parsing", () => {
  it("drops our own name and returns the two opponents", () => {
    expect(parseTeams("RMNT v Iron Wolves v Nightfall")).toEqual(["Iron Wolves", "Nightfall"]);
    expect(parseTeams("Iron Wolves vs RMNT vs Nightfall")).toEqual(["Iron Wolves", "Nightfall"]);
    expect(parseTeams("REMNANT v Alpha")).toEqual(["Alpha"]);
  });
  it("returns nothing when the title has no teams", () => {
    expect(parseTeams("Weekly scrim")).toEqual(["Weekly scrim"]);
    expect(parseTeams("")).toEqual([]);
  });
  it("makes keys that merge spelling variations", () => {
    expect(teamKey("Iron  Wolves")).toBe(teamKey("iron-wolves"));
    expect(teamKey("Team A")).not.toBe(teamKey("Team B"));
  });
});
