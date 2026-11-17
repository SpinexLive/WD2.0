import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), fixtures: vi.fn(), request: vi.fn(), read: vi.fn(), key: "" }));
vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/env", () => ({ env: () => ({ GWL_API_KEY: mocks.key, DISCORD_BOT_TOKEN: "test", DISCORD_GUILD_ID: "guild" }) }));
vi.mock("@/lib/http", () => ({ requestJson: mocks.request }));
vi.mock("@/server/services/gwl", () => ({ getGwlFixtures: mocks.fixtures }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.read }));

import { syncCalendarIcon } from "@/server/services/calendarIcon";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.key = "";
  mocks.query.mockImplementation(async (sql: string) => sql.startsWith("SELECT") ? [{ current_icon: "default", last_error: null }] : []);
  mocks.read.mockResolvedValue(Buffer.from("icon"));
  mocks.request.mockResolvedValue({});
});

describe("calendar icon sync", () => {
  it("updates holiday icons without a GWL key", async () => {
    await syncCalendarIcon(Date.parse("2026-12-15T12:00:00Z"));
    expect(mocks.fixtures).not.toHaveBeenCalled();
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("SET current_icon"), ["christmas"]);
  });

  it("retains the current icon and records an error for a stale GWL feed", async () => {
    mocks.key = "configured";
    mocks.fixtures.mockResolvedValue({ stale: true, error: "GWL unavailable" });
    await syncCalendarIcon(Date.parse("2026-12-15T12:00:00Z"));
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("SET last_error"), ["GWL unavailable"]);
  });
});
