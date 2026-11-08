import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ session: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: mocks.limit }));
vi.mock("@/lib/env", () => ({ env: () => ({ APP_URL: "https://example.com", DISCORD_MEMBERS_VIEWER_ROLE_ID: "1547229723141345351" }) }));

import { protectedRoute } from "@/lib/apiGuard";
import { hasMembersViewerRole } from "@/server/services/discord";

const route = protectedRoute(async () => ({ ok: true }), { membersViewerOnly: true });
const context = { params: Promise.resolve({}) };
const request = (method: string) => new NextRequest("https://example.com/api/members", {
  method,
  ...(method !== "GET" ? { headers: { origin: "https://example.com", "x-csrf-token": "csrf" } } : {}),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockResolvedValue(0);
});

describe("Members viewer access", () => {
  it("recognizes only the configured viewer role", () => {
    expect(hasMembersViewerRole(["1547229723141345351"])).toBe(true);
    expect(hasMembersViewerRole(["1349704360816414762"])).toBe(false);
  });

  it("allows the dedicated role to read but not mutate Members endpoints", async () => {
    mocks.session.mockResolvedValue({ discordId: "viewer", isAdmin: false, canViewMembers: true, csrfToken: "csrf" });
    expect((await route(request("GET"), context)).status).toBe(200);
    expect((await route(request("POST"), context)).status).toBe(403);
  });

  it("does not grant Members access to regular members", async () => {
    mocks.session.mockResolvedValue({ discordId: "member", isAdmin: false, canViewMembers: false, csrfToken: "csrf" });
    expect((await route(request("GET"), context)).status).toBe(403);
  });

  it("preserves staff access", async () => {
    mocks.session.mockResolvedValue({ discordId: "staff", isAdmin: true, canViewMembers: false, csrfToken: "csrf" });
    expect((await route(request("GET"), context)).status).toBe(200);
    expect((await route(request("POST"), context)).status).toBe(200);
  });
});
