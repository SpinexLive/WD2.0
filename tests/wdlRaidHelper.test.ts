import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/env", () => ({ env: () => ({
  DISCORD_GUILD_ID: "1332320879073296404", DISCORD_BOT_TOKEN: "bot-test",
  RAID_HELPER_BASE_URL: "https://raid-helper.dev", RAID_HELPER_API_TOKEN: "raid-test",
}) }));
vi.mock("@/lib/http", async (original) => ({ ...await original<typeof import("@/lib/http")>(), requestJson: request }));

import { createWdlRaidEvent, deleteWdlRaidEvent, getPostedWdlEvents, updateWdlEventDescription, updatedWdlDescription, wdlEventBody, wdlEventNames } from "@/server/services/wdlRaidHelper";
import type { WdlFixture } from "@/lib/wdlFixtures";

const fixture: WdlFixture = {
  id: "fixture", number: 42, status: "SCHEDULED", scheduledAt: "2030-01-25T19:00:00Z",
  map: null, gameMode: null, competition: null,
  participants: [
    { team: { code: "RMNT", name: null }, faction: null, finishingPosition: null, points: null, noShow: null },
    { team: { code: "WTH", name: null }, faction: null, finishingPosition: null, points: null, noShow: null },
  ],
};
const roles = [{ id: "1546184733174669424", name: "Member" }];
const channels = [{ id: "1546197103498363031", name: "Briefing", type: 2 }];

beforeEach(() => {
  vi.resetAllMocks();
  request.mockImplementation(async ({ url }: { url: string }) => {
    if (url.endsWith("/roles")) return { data: roles };
    if (url.endsWith("/channels")) return { data: channels };
    throw new Error("Unexpected request");
  });
});

describe("Raid Helper fixture API", () => {
  it("resolves configured role and voice IDs to unique names", async () => {
    expect(await wdlEventNames()).toMatchObject({ role: "Member", voice: "Briefing" });
    request.mockImplementation(async ({ url }: { url: string }) => ({
      data: url.endsWith("/roles") ? [...roles, { id: "other", name: "member" }] : channels,
    }));
    await expect(wdlEventNames()).rejects.toMatchObject({ code: "wdl_name_ambiguous" });
  });

  it("creates only in an approved channel and never automatically retries writes", async () => {
    const body = wdlEventBody(fixture, { role: "Member", voice: "Briefing", roleNames: [] }, 1);
    request.mockResolvedValue({ data: { status: "success", event: { id: "schedule" } } });
    expect(await createWdlRaidEvent("1546479425644793877", body)).toMatchObject({ event: { id: "schedule" } });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST", url: expect.stringContaining("/servers/1332320879073296404/channels/1546479425644793877/event"),
      retries: 0, headers: { Authorization: "raid-test" },
    }));
    await expect(createWdlRaidEvent("other", body)).rejects.toMatchObject({ code: "invalid_channel" });
    request.mockResolvedValue({ data: { status: "failure", event: { id: "schedule" } } });
    await expect(createWdlRaidEvent("1546479425644793877", body)).rejects.toThrow("did not confirm");
  });

  it("reads every documented posted-event page using the Page header", async () => {
    request.mockResolvedValueOnce({ data: { pages: 2, postedEvents: [{ id: "one", channelId: "channel", title: "One", startTime: 1 }] } })
      .mockResolvedValueOnce({ data: { pages: 2, postedEvents: [{ id: "two", channelId: "channel", title: "Two", startTime: 2 }] } });
    expect((await getPostedWdlEvents()).map((event) => event.id)).toEqual(["one", "two"]);
    expect(request.mock.calls[0]![0].headers.Page).toBe("1");
    expect(request.mock.calls[1]![0].headers.Page).toBe("2");
  });

  it("does not claim deletion succeeded when the API did not confirm it", async () => {
    request.mockResolvedValue({ data: { status: "failure" } });
    await expect(deleteWdlRaidEvent("event1")).rejects.toThrow("did not confirm");
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", retries: 0 }));
  });

  it("preserves unrelated staff text while updating identified fields", () => {
    const current = "Notes above\n**Map:** Old · Default · Fog\nManual notes\n**Factions:** RMNT: MANTICORE\nNotes below";
    const proposed = updatedWdlDescription(current, { ...fixture, map: "Ozeti · Default · DayEarlyFog" });
    expect(proposed).toContain("Notes above\n**Map:** Ozeti\n**Zone:** Default\n**Weather:** DayEarlyFog\n**Factions:**");
    expect(proposed).toContain("Manual notes\nNotes below");
    expect(proposed).not.toContain("Old ·");
    expect(updatedWdlDescription(proposed, { ...fixture, map: "Ozeti · Default · DayEarlyFog" })).toBe(proposed);
  });

  it("excludes ambiguous or unexpected descriptions", () => {
    expect(() => updatedWdlDescription("**Map:** One\n**Map:** Two\n**Factions:** A", fixture)).toThrow("uniquely");
    expect(() => updatedWdlDescription("**Map:** One", fixture)).toThrow("uniquely");
    expect(() => updatedWdlDescription("**Map:** One\r\n**Factions:** A", fixture)).toThrow("unexpected format");
  });

  it("patches only the description without retries and checks the response", async () => {
    request.mockResolvedValue({ data: { status: "success", event: { id: "event1" } } });
    await updateWdlEventDescription("event1", "New");
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: "PATCH", url: expect.stringContaining("/api/v4/events/event1"), body: { description: "New" }, retries: 0,
    }));
    request.mockResolvedValue({ data: { status: "success", event: { id: "other" } } });
    await expect(updateWdlEventDescription("event1", "New")).rejects.toThrow("did not confirm");
  });
});
