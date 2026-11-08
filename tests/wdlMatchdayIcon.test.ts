import { describe, expect, it } from "vitest";
import { wdlFixtureSchema, type WdlFixtures } from "@/lib/wdlFixtures";
import { isWdlMatchdayIconActive } from "@/server/services/wdlMatchdayIcon";

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
});
