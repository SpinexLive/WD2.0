import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: () => ({
  DISCORD_GUILD_ID: "1332320879073296404", DISCORD_MEMBER_ROLE_ID: "1546184733174669424", DISCORD_BOT_TOKEN: "test",
}) }));
vi.mock("@/lib/http", async (original) => ({ ...await original<typeof import("@/lib/http")>(), requestJson: mocks.request }));
vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/server/services/loadout", () => ({ getConfig: async () => null }));

import { invalidate } from "@/lib/cache";
import { previewLoadoutReminder } from "@/server/services/loadoutReminder";

beforeEach(() => {
  vi.resetAllMocks();
  invalidate("discord:guild-members");
  mocks.query.mockResolvedValue([]);
});

it("includes only current Wardogs-role members, excluding other roles and bots", async () => {
  mocks.request.mockResolvedValue({ data: [
    { user: { id: "100000000000000001", username: "member" }, roles: ["1546184733174669424"] },
    { user: { id: "100000000000000002", username: "other" }, roles: ["1433399320903815188"] },
    { user: { id: "100000000000000003", username: "bot", bot: true }, roles: ["1546184733174669424"] },
  ] });
  expect(await previewLoadoutReminder()).toMatchObject({ count: 1 });
  expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining("/guilds/1332320879073296404/members") }));
});
