import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), clan: vi.fn(), allClan: vi.fn(), links: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/server/services/discord", () => ({ getClanMembers: mocks.clan, getAllClanMembers: mocks.allClan }));
vi.mock("@/server/services/links", () => ({ resolveLinks: mocks.links }));

import { buildRecruitReport } from "@/server/services/recruit";

const snapshot = { data: [], stale: false, fetchedAt: "2026-01-01T00:00:00Z" };
const links = { steamIds: new Map(), manual: new Map(), source: { available: true, stale: false, fetchedAt: snapshot.fetchedAt, error: null } };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue([]);
  mocks.clan.mockResolvedValue(snapshot);
  mocks.allClan.mockResolvedValue(snapshot);
  mocks.links.mockResolvedValue(links);
});

describe("recruit alert source safety", () => {
  it.each(["clan", "allClan"] as const)("rejects a stale %s member snapshot", async (source) => {
    mocks[source].mockResolvedValue({ ...snapshot, stale: true, error: "unavailable" });
    await expect(buildRecruitReport({ strictSources: true })).rejects.toThrow("requires current Discord members");
  });

  it.each([
    { available: false, stale: false },
    { available: true, stale: true },
  ])("rejects unavailable or stale official links", async (source) => {
    mocks.links.mockResolvedValue({ ...links, source: { ...links.source, ...source } });
    await expect(buildRecruitReport({ strictSources: true })).rejects.toThrow("requires current Discord members");
    expect(mocks.links).toHaveBeenCalledWith(true);
  });
});
