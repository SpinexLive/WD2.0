import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/env", () => ({ env: () => ({
  DISCORD_GUILD_ID: "1332320879073296404", RAID_HELPER_API_TOKEN: "test",
  RAID_HELPER_BASE_URL: "https://raid-helper.dev", RAID_HELPER_EVENTS_PATH: "/api/v4/servers/{guildId}/events",
}) }));
vi.mock("@/lib/http", async (original) => ({ ...await original<typeof import("@/lib/http")>(), requestJson: request }));

import { invalidate } from "@/lib/cache";
import { getEvents } from "@/server/services/raidHelper";

beforeEach(() => {
  vi.resetAllMocks();
  invalidate("rh:events");
});

describe("Raid Helper event pagination", () => {
  it("uses the documented Page header and loads all pages", async () => {
    request.mockResolvedValueOnce({ data: { pages: 2, currentPage: 1, postedEvents: [{ id: "1", title: "First" }] } })
      .mockResolvedValueOnce({ data: { pages: 2, currentPage: 2, postedEvents: [{ id: "2", title: "Second" }] } });
    expect((await getEvents()).data.map((event) => event.id)).toEqual(["1", "2"]);
    expect(request.mock.calls[0]![0]).toMatchObject({ headers: { Authorization: "test", Page: "1" } });
    expect(request.mock.calls[1]![0]).toMatchObject({ headers: { Authorization: "test", Page: "2" } });
  });

  it("reports repeated or unexpected pages instead of silently omitting events", async () => {
    request.mockResolvedValueOnce({ data: { pages: 2, currentPage: 1, postedEvents: [{ id: "1" }] } })
      .mockResolvedValueOnce({ data: { pages: 2, currentPage: 1, postedEvents: [{ id: "1" }] } });
    await expect(getEvents()).rejects.toThrow("unexpected event page");
  });

  it("accepts an empty first page when Raid Helper reports zero pages", async () => {
    request.mockResolvedValue({ data: { pages: 0, currentPage: 0, postedEvents: [] } });
    expect((await getEvents()).data).toEqual([]);
  });
});
