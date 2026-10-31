import { beforeEach, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/env", () => ({ env: () => ({ GAME_RCON_URL: "http://game.test:7779/", GAME_RCON_PASSWORD: "test-password" }) }));
vi.mock("@/lib/http", () => ({ requestJson: request }));
import { remindSeedingPlayer, SEEDING_AFK_REMINDER, seedingSnapshot } from "@/server/services/seedingRcon";

beforeEach(() => { vi.clearAllMocks(); request.mockResolvedValue({ data: { message: "OK" } }); });
it("sends a private message through the configured game RCON without automatic retries", async () => {
  await remindSeedingPlayer("76561198000000001");
  expect(request).toHaveBeenCalledWith(expect.objectContaining({
    url: "http://game.test:7779/v1/players/76561198000000001/message", method: "POST",
    headers: { Authorization: "Bearer test-password" }, body: { message: SEEDING_AFK_REMINDER }, retries: 0,
  }));
  expect(SEEDING_AFK_REMINDER.length).toBeLessThanOrEqual(256);
});
it("rejects an invalid player ID before contacting RCON", async () => {
  await expect(remindSeedingPlayer("invalid/id")).rejects.toThrow("Invalid Steam ID");
  expect(request).not.toHaveBeenCalled();
});
it("reads the live roster without requiring team balance configuration", async () => {
  request.mockResolvedValueOnce({ data: { uptimeSeconds: 100 } })
    .mockResolvedValueOnce({ data: { map: "map", players: { current: 1 }, factionScores: [{ name: "A" }, { name: "B" }] } })
    .mockResolvedValueOnce({ data: { count: 1, players: [{ steamId: "76561198000000001", name: "Player", faction: "A" }] } });
  expect(await seedingSnapshot()).toMatchObject({ count: 1, factions: ["A", "B"] });
  expect(request).toHaveBeenCalledTimes(3);
  expect(request.mock.calls.some(([options]) => options.url.endsWith("/v1/config"))).toBe(false);
});
