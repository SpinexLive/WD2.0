import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { RosterLeagueMark } from "@/components/RosterLeagueMark";

describe("roster league indicators", () => {
  it("shows a green GWL badge only for a confirmed Discord match", () => {
    const linked = renderToStaticMarkup(createElement(RosterLeagueMark, { league: "GWL", status: "linked" }));
    expect(linked).toContain("text-ok");
    expect(linked).toContain('aria-label="GWL: Linked by Discord ID"');
    expect(linked).toContain(">GWL</span>");
    expect(linked).not.toContain("✓");
    const notMatched = renderToStaticMarkup(createElement(RosterLeagueMark, { league: "GWL", status: "not_matched" }));
    expect(notMatched).toContain("text-blood-300");
    expect(notMatched).toContain("does not prove the player is unregistered");
    expect(renderToStaticMarkup(createElement(RosterLeagueMark, { league: "GWL", status: "unknown" }))).toContain("text-blood-300");
  });

  it("shows WDL registration with the same badge style and preserves pending status", () => {
    expect(renderToStaticMarkup(createElement(RosterLeagueMark, { league: "WDL", status: "registered" }))).toContain("text-ok");
    expect(renderToStaticMarkup(createElement(RosterLeagueMark, { league: "WDL", status: "not_registered" }))).toContain("text-blood-300");
    expect(renderToStaticMarkup(createElement(RosterLeagueMark, { league: "WDL", status: "unknown" }))).toContain("WDL: Unknown");
    expect(renderToStaticMarkup(createElement(RosterLeagueMark, { league: "WDL", status: "unknown" }))).toContain("text-blood-300");
    expect(renderToStaticMarkup(createElement(RosterLeagueMark, { league: "WDL", status: "pending" }))).toContain("text-warn");
  });
});
