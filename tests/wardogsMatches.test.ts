import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/env", () => ({ env: () => ({ WARDOGS_API_KEY: "test-key" }) }));
vi.mock("@/lib/http", async (original) => ({ ...await original<typeof import("@/lib/http")>(), requestJson: request }));

import { invalidate } from "@/lib/cache";
import { getMatches } from "@/server/services/wardogsRcon";

describe("Wardogs match discovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invalidate("rcon:matches");
  });

  it("reads the available recent matches", async () => {
    request.mockResolvedValue({ data: { ok: true, matches: [{ id: 1, endedAt: "2026-01-01T00:00:00Z" }] } });
    expect((await getMatches()).data).toMatchObject([{ id: 1, endedAt: "2026-01-01T00:00:00Z" }]);
  });

  it.each([[{ id: null }], [{ id: -1 }], [{ id: 1.5 }], [{ id: 1 }, { id: 1 }]])(
    "reports invalid or duplicate IDs instead of silently omitting matches",
    async (...matches) => {
      request.mockResolvedValue({ data: { ok: true, matches } });
      await expect(getMatches()).rejects.toThrow("invalid or duplicate match ID");
    },
  );
});
