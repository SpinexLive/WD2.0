import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: () => ({ DATABASE_URL: "postgres://test" }) }));
vi.mock("pg", () => ({
  Pool: class {
    connect = mocks.connect;
  },
}));

import { withLeagueEventLock } from "@/lib/db";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
  mocks.query.mockResolvedValue({ rows: [] });
});

describe("league event worker lock", () => {
  it("waits for the lock before running GWL work", async () => {
    let unlock!: () => void;
    const locked = new Promise<void>((resolve) => { unlock = resolve; });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_advisory_xact_lock")) await locked;
      return { rows: [] };
    });
    const work = vi.fn();
    const running = withLeagueEventLock(work, true);
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledWith("SELECT pg_advisory_xact_lock($1)", [824035]));
    expect(work).not.toHaveBeenCalled();
    unlock();
    await running;
    expect(work).toHaveBeenCalledOnce();
    expect(mocks.query).toHaveBeenCalledWith("COMMIT");
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("preserves nonblocking behavior for WDL", async () => {
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("pg_try_advisory_xact_lock") ? [{ acquired: false }] : [],
    }));
    const work = vi.fn();
    await withLeagueEventLock(work);
    expect(work).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledWith("SELECT pg_try_advisory_xact_lock($1) AS acquired", [824035]);
  });
});
