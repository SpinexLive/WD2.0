import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WdlParticipants } from "@/components/WdlParticipants";
import { WdlMapDetails } from "@/components/WdlMapDetails";
import { Fixture } from "@/app/(dashboard)/(staff)/wdl/FixturesPanel";
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

  it("renders labeled WDL map fields and does not display game mode", () => {
    const fixture: WdlFixture = {
      id: "fixture", number: 106, status: "SCHEDULED", scheduledAt: null,
      map: "Ozeti · Default · DayEarlyFog", gameMode: "Unwanted mode", competition: null,
      participants: [participant("RMNT", "MANTICORE")],
    };
    const markup = renderToStaticMarkup(createElement(Fixture, { fixture, result: false }));
    expect(markup).toContain("Map: Ozeti");
    expect(markup).toContain("Zone: Default");
    expect(markup).toContain("Weather: DayEarlyFog");
    expect(markup).not.toContain("Unwanted mode");
    expect(markup).not.toContain("Mode TBC");
    const missing = renderToStaticMarkup(createElement(WdlMapDetails, { value: null }));
    expect(missing).toContain("Map: TBC");
    expect(missing).toContain("Zone: TBC");
    expect(missing).toContain("Weather: TBC");
  });
});
