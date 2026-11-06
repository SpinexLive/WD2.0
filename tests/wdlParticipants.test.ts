import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WdlParticipants } from "@/components/WdlParticipants";
import type { WdlFixture } from "@/lib/wdlFixtures";

const participant = (code: string, faction: string | null): WdlFixture["participants"][number] => ({
  team: { code, name: null }, faction, finishingPosition: 2, points: 0, noShow: true,
});

describe("WDL participant faction icons", () => {
  it("renders the three faction icons beside their teams, ignoring case and whitespace", () => {
    const markup = renderToStaticMarkup(createElement(WdlParticipants, { participants: [
      participant("A", "VALKYRA"), participant("B", " lonestar "), participant("C", "Manticore"),
    ] }));
    expect(markup).toContain("/images/wardogs-factions-valkyra.webp");
    expect(markup).toContain("/images/wardogs-factions-lonestar.webp");
    expect(markup).toContain("/images/wardogs-factions-manticore.webp");
    expect(markup).toContain("A: VALKYRA");
    expect(markup).not.toContain("Position");
  });

  it("retains result details and shows unknown or missing factions without an icon", () => {
    const markup = renderToStaticMarkup(createElement(WdlParticipants, { result: true, participants: [
      participant("A", null), participant("B", "constructor"),
    ] }));
    expect(markup).toContain("A: Faction TBC");
    expect(markup).toContain("B: constructor");
    expect(markup).toContain("Position 2");
    expect(markup).toContain("0 points");
    expect(markup).toContain("No show");
    expect(markup).not.toContain("<img");
  });
});
