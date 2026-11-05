import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ links: vi.fn(), stats: vi.fn() }));
vi.mock("@/server/services/links", () => ({ resolveLinks: mocks.links }));
vi.mock("@/server/services/wardogsRcon", () => ({ getPlayerStats: mocks.stats }));

import { rosterStatsFor } from "@/server/services/rosterPublish";

const a = "100000000000000001";
const b = "100000000000000002";
const steamA = "76561198000000001";
const steamB = "76561198000000002";
const validLinks = {
  steamIds: new Map([[a, steamA], [b, steamB]]),
  manual: new Map<string, string>(),
  source: { available: true, stale: false },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.links.mockResolvedValue(validLinks);
  mocks.stats.mockResolvedValue({ stale: false, data: { kd: 1.25, deaths: 4 } });
});
afterEach(() => vi.useRealTimers());

describe("roster player K/D lookup", () => {
  it("uses linked Steam IDs, deduplicates players, and retains genuine zero K/D", async () => {
    mocks.stats.mockResolvedValueOnce({ stale: false, data: { kd: 0, deaths: 3 } });
    const result = await rosterStatsFor([a, a, b], true);
    expect(result.get(a)).toEqual({ kd: 0, deaths: 3 });
    expect(result.get(b)).toEqual({ kd: 1.25, deaths: 4 });
    expect(mocks.stats).toHaveBeenCalledTimes(2);
    expect(mocks.stats).toHaveBeenCalledWith(steamA, true);
  });

  it("does not use stale official links and logs unavailable K/D", async () => {
    mocks.links.mockResolvedValue({ ...validLinks, manual: new Map([[b, steamB]]), source: { available: true, stale: true } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = await rosterStatsFor([a, b], false);
      expect(result.has(a)).toBe(false);
      expect(result.has(b)).toBe(true);
      expect(mocks.stats).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("does not silently treat stale or failed player data as a zero", async () => {
    mocks.stats.mockResolvedValueOnce({ stale: true, data: { kd: 2, deaths: 4 } }).mockRejectedValueOnce(new Error("provider down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect((await rosterStatsFor([a, b], false)).size).toBe(0);
      expect(warn).toHaveBeenCalled();
      expect(log).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });

  it("returns a stable partial result after the six-second lookup limit", async () => {
    vi.useFakeTimers();
    let finish!: (value: { stale: boolean; data: { kd: number; deaths: number } }) => void;
    mocks.stats.mockResolvedValueOnce({ stale: false, data: { kd: 1, deaths: 2 } })
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = rosterStatsFor([a, b], false);
    await vi.advanceTimersByTimeAsync(6000);
    const result = await pending;
    expect(result.get(a)).toEqual({ kd: 1, deaths: 2 });
    expect(result.has(b)).toBe(false);
    finish({ stale: false, data: { kd: 3, deaths: 2 } });
    await vi.runAllTicks();
    expect(result.has(b)).toBe(false);
  });
});
