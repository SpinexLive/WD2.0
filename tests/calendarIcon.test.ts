import { describe, expect, it } from "vitest";
import { getCalendarIconVariant, isGwlMatchdayIconActive } from "@/server/services/calendarIcon";
import { gwlFixtureSchema } from "@/server/services/gwl";

const fixture = (startsAt: string, status = "SCHEDULED") => gwlFixtureSchema.parse({
  number: "42", status, map: "Map", layer: null, startsAt, region: "EU", sides: [],
});

describe("GWL matchday server icon", () => {
  it("uses London time and restores one hour after the latest match", () => {
    const data = { upcoming: [fixture("2026-11-08T19:00:00Z")], recent: [fixture("2026-11-08T12:00:00Z", "COMPLETED")] };
    expect(isGwlMatchdayIconActive(data, Date.parse("2026-11-08T00:59:00Z"))).toBe(false);
    expect(isGwlMatchdayIconActive(data, Date.parse("2026-11-08T01:00:00Z"))).toBe(true);
    expect(isGwlMatchdayIconActive(data, Date.parse("2026-11-08T19:59:59Z"))).toBe(true);
    expect(isGwlMatchdayIconActive(data, Date.parse("2026-11-08T20:00:00Z"))).toBe(false);
  });

  it("respects daylight saving and ignores cancelled matches", () => {
    const data = { upcoming: [fixture("2026-03-29T00:30:00Z")], recent: [] };
    expect(isGwlMatchdayIconActive(data, Date.parse("2026-03-29T00:59:00Z"))).toBe(false);
    expect(isGwlMatchdayIconActive(data, Date.parse("2026-03-29T01:00:00Z"))).toBe(true);
    expect(isGwlMatchdayIconActive(data, Date.parse("2026-03-29T01:30:00Z"))).toBe(false);
    expect(isGwlMatchdayIconActive({ upcoming: [fixture("2026-11-08T19:00:00Z", "CANCELLED")], recent: [] }, Date.parse("2026-11-08T12:00:00Z"))).toBe(false);
  });

  it("prioritizes single-day holidays, but matchdays override multi-day holidays", () => {
    expect(getCalendarIconVariant(Date.parse("2026-11-08T12:00:00Z"), true)).toBe("remembrance");
    expect(getCalendarIconVariant(Date.parse("2027-03-26T12:00:00Z"), true)).toBe("matchday");
    expect(getCalendarIconVariant(Date.parse("2026-12-31T12:00:00Z"))).toBe("newyear");
    expect(getCalendarIconVariant(Date.parse("2027-01-03T00:00:00Z"))).toBe("default");
  });
});
