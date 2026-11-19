import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/env", () => ({
  env: () => ({ RAID_HELPER_BASE_URL: "https://raid-helper.dev", RAID_HELPER_API_TOKEN: "test" }),
}));
vi.mock("@/lib/http", async (original) => {
  const actual = await original<typeof import("@/lib/http")>();
  return { ...actual, requestJson: mocks.request };
});

import { deleteLeagueRaidEvent } from "@/server/services/leagueRaidHelper";

describe("Raid Helper event deletion", () => {
  beforeEach(() => vi.resetAllMocks());

  it("accepts the verified scheduled-event deletion response", async () => {
    mocks.request.mockResolvedValue({ data: { status: "Event deleted" } });
    await expect(deleteLeagueRaidEvent("1376958958463357068-1")).resolves.toBeUndefined();
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
      method: "DELETE", url: "https://raid-helper.dev/api/v4/events/1376958958463357068-1", retries: 0,
    }));
  });

  it("does not accept an unrecognised response as confirmation", async () => {
    mocks.request.mockResolvedValue({ data: { status: "pending" } });
    await expect(deleteLeagueRaidEvent("1376958958463357068-1")).rejects.toThrow("did not confirm");
  });
});
