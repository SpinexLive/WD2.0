import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ session: vi.fn(), rateLimit: vi.fn(), request: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/ratelimit", () => ({
  rateLimit: mocks.rateLimit,
  singleFlight: async (_key: string, callback: () => Promise<unknown>) => callback(),
}));
vi.mock("@/lib/env", () => ({ env: () => ({ GWL_API_KEY: "test-key", APP_URL: "https://dashboard.test" }) }));
vi.mock("@/lib/http", async (original) => {
  const actual = await original<typeof import("@/lib/http")>();
  return { ...actual, requestJson: mocks.request };
});
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import { getGwlMembers, getGwlFixtures, gwlFixtureSchema, nextGwlFixture } from "@/server/services/gwl";
import { POST } from "@/app/api/gwl/applications/[id]/respond/route";

const context = { params: Promise.resolve({ id: "app-1" }) };
const post = (body: unknown, csrf = "csrf") => new NextRequest("https://dashboard.test/api/gwl/applications/app-1/respond", {
  method: "POST",
  headers: { origin: "https://dashboard.test", "x-csrf-token": csrf, "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rateLimit.mockResolvedValue(0);
  mocks.session.mockResolvedValue({ discordId: "staff", isAdmin: true, csrfToken: "csrf", displayName: "Staff" });
  mocks.audit.mockResolvedValue(undefined);
});

describe("GWL integration", () => {
  it("accepts roster entries without optional player IDs", async () => {
    mocks.request.mockResolvedValue({ data: { members: [{ name: "Player", role: "member" }] } });
    expect((await getGwlMembers(true)).data.members[0]).toEqual({ name: "Player", role: "member" });
  });

  it("retains scoped Discord IDs without exposing Steam IDs", async () => {
    mocks.request.mockResolvedValue({ data: { members: [
      { name: "Player", role: "member", discordId: "123456789012345678", steamId: "76561198000000000" },
      { name: "Unlinked", role: "member", discordId: null },
    ] } });
    expect((await getGwlMembers(true)).data.members).toEqual([
      { name: "Player", role: "member", discordId: "123456789012345678" },
      { name: "Unlinked", role: "member", discordId: null },
    ]);
  });

  it("validates the documented fixture shape and refuses malformed data", async () => {
    mocks.request.mockResolvedValueOnce({ data: { upcoming: [{
      number: "42", status: "SCHEDULED", map: "Map", layer: null, startsAt: "2026-11-15T20:00:00Z",
      region: "EU", sides: [{ team: { slug: "rmnt", name: "Remnant", tag: "RMNT" }, faction: null, points: null, score: null, placement: null, eloDelta: null }],
    }], recent: [] } });
    expect((await getGwlFixtures(true)).data.upcoming[0]?.number).toBe("42");
    mocks.request.mockResolvedValueOnce({ data: { upcoming: "invalid" } });
    const snapshot = await getGwlFixtures(true);
    expect(snapshot.stale).toBe(true);
  });

  it("does not accept duplicate fixture numbers", async () => {
    const fixture = {
      number: "duplicate", status: "SCHEDULED", map: "Map", layer: null,
      startsAt: "2026-11-15T20:00:00Z", region: "EU", sides: [],
    };
    mocks.request.mockResolvedValueOnce({ data: { upcoming: [fixture], recent: [fixture] } });
    const snapshot = await getGwlFixtures(true);
    expect(snapshot.stale).toBe(true);
  });

  it("finds the next non-cancelled future match", () => {
    const fixture = gwlFixtureSchema.parse({
      number: "1", status: "SCHEDULED", map: "Map", layer: null,
      startsAt: "2026-11-15T20:00:00Z", region: "EU", sides: [],
    });
    expect(nextGwlFixture([
      { ...fixture, number: "cancelled", status: "CANCELLED", startsAt: "2026-11-14T20:00:00Z" },
      fixture,
    ], Date.parse("2026-11-13T00:00:00Z"))?.number).toBe("1");
    expect(nextGwlFixture([fixture], Date.parse("2026-11-16T00:00:00Z"))).toBeNull();
  });

  it("requires staff access and CSRF before responding", async () => {
    mocks.session.mockResolvedValueOnce({ discordId: "member", isAdmin: false });
    expect((await POST(post({ accept: true }), context)).status).toBe(403);
    expect((await POST(post({ accept: true }, "bad"), context)).status).toBe(403);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("confirms the application is pending before sending and auditing a decision", async () => {
    const application = { id: "app-1", name: "Player", note: null, appliedAt: "2026-11-01T00:00:00Z", deadline: "2026-11-15T00:00:00Z" };
    mocks.request.mockImplementation(async ({ url, method }: { url: string; method?: string }) => {
      if (method === "POST") return { data: {} };
      if (url.endsWith("/applications")) return { data: { applications: [application] } };
      if (url.endsWith("/members")) return { data: { members: [] } };
      throw new Error("Unexpected request");
    });
    const response = await POST(post({ accept: true }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, outcome: "accepted", refreshed: true });
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", body: { accept: true }, retries: 0 }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), "gwl.application_accept", "gwl_application", "app-1");
  });
});
