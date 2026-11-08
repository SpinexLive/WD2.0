import { describe, expect, it } from "vitest";
import { HOLIDAY_LOGOS } from "@/lib/calendarLogos";
import { wdlFixtureSchema, type WdlFixtures } from "@/lib/wdlFixtures";
import { getCalendarIconVariant, isWdlMatchdayIconActive } from "@/server/services/wdlMatchdayIcon";

function fixtures(scheduledAt: string, code = "RMNT", status = "SCHEDULED"): WdlFixtures {
  const fixture = wdlFixtureSchema.parse({
    id: "fixture-1",
    status,
    scheduledAt,
    participants: [
      { team: { code, name: "REMNANT" } },
      { team: { code: "OPP", name: "Opponent" } },
    ],
  });
  return { upcoming: [fixture], recent: [] };
}

describe("WDL matchday server icon schedule", () => {
  it("switches at 01:00 Europe/London and restores one hour after match start", () => {
    const data = fixtures("2026-11-08T19:00:00+00:00");
    expect(isWdlMatchdayIconActive(data, Date.parse("2026-11-08T00:59:00+00:00"))).toBe(false);
    expect(isWdlMatchdayIconActive(data, Date.parse("2026-11-08T01:00:00+00:00"))).toBe(true);
    expect(isWdlMatchdayIconActive(data, Date.parse("2026-11-08T19:59:59+00:00"))).toBe(true);
    expect(isWdlMatchdayIconActive(data, Date.parse("2026-11-08T20:00:00+00:00"))).toBe(false);
  });

  it("uses the London calendar date across UTC midnight and daylight saving time", () => {
    const data = fixtures("2026-03-29T00:30:00+00:00");
    expect(isWdlMatchdayIconActive(data, Date.parse("2026-03-29T00:59:00+00:00"))).toBe(false);
    expect(isWdlMatchdayIconActive(data, Date.parse("2026-03-29T01:00:00+00:00"))).toBe(true);
    expect(isWdlMatchdayIconActive(data, Date.parse("2026-03-29T01:30:00+00:00"))).toBe(false);
  });

  it("ignores fixtures without RMNT and fixtures cancelled by WDL", () => {
    expect(isWdlMatchdayIconActive(fixtures("2026-11-08T19:00:00+00:00", "OTHER"), Date.parse("2026-11-08T12:00:00+00:00"))).toBe(false);
    expect(isWdlMatchdayIconActive(fixtures("2026-11-08T19:00:00+00:00", "RMNT", "CANCELLED"), Date.parse("2026-11-08T12:00:00+00:00"))).toBe(false);
  });

  it("keeps the matchday icon while another same-day match is within its hour window", () => {
    const first = wdlFixtureSchema.parse({
      id: "first", status: "COMPLETED", scheduledAt: "2026-11-08T12:00:00+00:00",
      participants: [{ team: { code: "RMNT", name: "REMNANT" } }],
    });
    const second = wdlFixtureSchema.parse({
      id: "second", status: "SCHEDULED", scheduledAt: "2026-11-08T19:00:00+00:00",
      participants: [{ team: { code: "RMNT", name: "REMNANT" } }],
    });
    expect(isWdlMatchdayIconActive({ upcoming: [second], recent: [first] }, Date.parse("2026-11-08T13:00:00+00:00"))).toBe(true);
  });

  it("uses the supplied holiday dates inclusively", () => {
    expect(HOLIDAY_LOGOS.map(({ key, startDate, endDate }) => [key, startDate, endDate])).toEqual([
      ["newyear", "2026-12-31", "2027-01-02"],
      ["remembrance", "2026-11-08", "2026-11-08"],
      ["st-patricks", "2027-03-17", "2027-03-17"],
      ["halloween", "2027-10-31", "2027-10-31"],
      ["easter", "2027-03-26", "2027-03-29"],
      ["christmas", "2026-12-01", "2026-12-31"],
    ]);
    expect(getCalendarIconVariant(fixtures("2027-01-10T19:00:00+00:00"), Date.parse("2026-12-31T12:00:00+00:00"))).toBe("newyear");
    expect(getCalendarIconVariant(fixtures("2027-01-10T19:00:00+00:00"), Date.parse("2027-01-02T12:00:00+00:00"))).toBe("newyear");
    expect(getCalendarIconVariant(fixtures("2027-01-10T19:00:00+00:00"), Date.parse("2027-01-03T00:00:00+00:00"))).toBe("default");
    expect(getCalendarIconVariant(fixtures("2027-01-10T19:00:00+00:00"), Date.parse("2026-12-15T12:00:00+00:00"))).toBe("christmas");
  });

  it("lets a single-day holiday win over match day", () => {
    const data = fixtures("2026-11-08T19:00:00+00:00");
    expect(getCalendarIconVariant(data, Date.parse("2026-11-08T19:59:00+00:00"))).toBe("remembrance");
    expect(getCalendarIconVariant(data, Date.parse("2026-11-08T20:00:00+00:00"))).toBe("remembrance");
    expect(getCalendarIconVariant(data, Date.parse("2026-11-09T00:00:00+00:00"))).toBe("default");
  });

  it("lets match day override multi-day holidays, with New Year taking Dec 31 without a match", () => {
    const easterMatch = fixtures("2027-03-26T19:00:00+00:00");
    expect(getCalendarIconVariant(easterMatch, Date.parse("2027-03-26T12:00:00+00:00"))).toBe("matchday");
    expect(getCalendarIconVariant(fixtures("2027-01-10T19:00:00+00:00"), Date.parse("2026-12-31T12:00:00+00:00"))).toBe("newyear");
  });

  it("keeps match day active through one hour after the latest same-day match", () => {
    const first = wdlFixtureSchema.parse({
      id: "first", status: "COMPLETED", scheduledAt: "2026-11-08T12:00:00+00:00",
      participants: [{ team: { code: "RMNT", name: "REMNANT" } }],
    });
    const second = wdlFixtureSchema.parse({
      id: "second", status: "SCHEDULED", scheduledAt: "2026-11-08T19:00:00+00:00",
      participants: [{ team: { code: "RMNT", name: "REMNANT" } }],
    });
    const data = { upcoming: [second], recent: [first] };
    expect(isWdlMatchdayIconActive(data, Date.parse("2026-11-08T17:00:00+00:00"))).toBe(true);
    expect(isWdlMatchdayIconActive(data, Date.parse("2026-11-08T20:00:00+00:00"))).toBe(false);
  });
});
