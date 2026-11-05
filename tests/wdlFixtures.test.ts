import { describe, expect, it } from "vitest";
import { fixtureOpponents, wdlFixturesSchema } from "@/lib/wdlFixtures";
import { wdlEventBody } from "@/server/services/wdlRaidHelper";

const match = "2026-11-25T19:00:00.000Z";
const fixture = wdlFixturesSchema.parse({
  upcoming: [{
    id: "fixture-42", number: 42, status: "SCHEDULED", scheduledAt: match, map: "Map",
    gameMode: null, competition: null,
    participants: [
      { team: { code: "RMNT", name: "Remnant" }, faction: null, finishingPosition: null, points: null, noShow: false },
      { team: { code: "WTH", name: "WTH" }, faction: "Lonestar", finishingPosition: null, points: null, noShow: false },
      { team: { code: "VLK", name: "VLK" }, faction: null, finishingPosition: null, points: null, noShow: false },
    ],
  }],
  recent: [],
}).upcoming[0]!;
const names = { role: "Wardogs Member", voice: "Briefing", roleNames: [] };
const matchSeconds = Date.parse(match) / 1000;

describe("WDL fixture parsing and event creation", () => {
  it("accepts nullable optional data and identifies all opponents by code", () => {
    expect(fixture.competition).toBeNull();
    expect(fixtureOpponents(fixture)).toEqual(["WTH", "VLK"]);
    expect(fixtureOpponents({ ...fixture, participants: fixture.participants.slice(1) })).toBeNull();
    expect(fixtureOpponents({ ...fixture, participants: [fixture.participants[0]!, fixture.participants[1]!, fixture.participants[1]!] })).toBeNull();
  });

  it("rejects malformed or duplicate fixtures instead of silently omitting them", () => {
    expect(wdlFixturesSchema.safeParse({ upcoming: [fixture, fixture], recent: [] }).success).toBe(false);
    expect(wdlFixturesSchema.safeParse({ upcoming: [{ ...fixture, scheduledAt: "not a date" }], recent: [] }).success).toBe(false);
    expect(wdlFixturesSchema.safeParse({ upcoming: [], recent: null }).success).toBe(false);
  });

  it("uses the chosen briefing, post time and Raid Helper options", () => {
    const now = matchSeconds - 20 * 86400;
    const body = wdlEventBody(fixture, names, now);
    const briefing = matchSeconds - 1800;
    expect(body.title).toBe("RMNT v WTH v VLK");
    expect(body.date).toBe(String(briefing));
    expect(body.time).toBe(String(briefing));
    expect(body.schedule).toBe(briefing - 10 * 86400);
    expect(body.description).toContain(`**Briefing Start:** <t:${briefing}:F>`);
    expect(body.description).toContain(`**Match Start:** <t:${matchSeconds}:F>`);
    expect(body.advancedSettings).toMatchObject({
      allowed_roles: names.role, mentions: names.role, voice_channel: names.voice,
      limit_per_user: 1, lock_at_limit: false, apply_unregister: true, opt_out: "none",
      vacuum: false, deletion: false, pin_message: false, create_discordevent: false,
      create_thread: false, reminder: 60, temp_role: "RMNT v WTH v VLK",
      tr_include: "signed+tentative", color: "#9E303C", header_image: "default",
    });
  });

  it("posts immediately within ten days and flags fixtures whose briefing has started", () => {
    expect(wdlEventBody(fixture, names, matchSeconds - 2 * 86400)).not.toHaveProperty("schedule");
    expect(() => wdlEventBody(fixture, names, matchSeconds - 1800)).toThrow("Briefing has already started");
  });

  it("uses the fixture number only for role-name collisions and never reuses a colliding suffix", () => {
    const body = wdlEventBody(fixture, { ...names, roleNames: ["rmnt v wth v vlk"] }, matchSeconds - 20 * 86400);
    expect(body.advancedSettings.temp_role).toBe("RMNT v WTH v VLK #42");
    expect(() => wdlEventBody(fixture, { ...names, roleNames: ["rmnt v wth v vlk", "rmnt v wth v vlk #42"] }, matchSeconds - 20 * 86400))
      .toThrow("already exists");
  });

  it("prevents unsafe opponent codes from being used in a real event", () => {
    const changed = { ...fixture, participants: [fixture.participants[0]!, { ...fixture.participants[1]!, team: { code: "@everyone", name: null } }] };
    expect(() => wdlEventBody(changed, names, matchSeconds - 20 * 86400)).toThrow("cannot safely");
  });
});
