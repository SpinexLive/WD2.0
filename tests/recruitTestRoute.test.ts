import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ session: vi.fn(), rateLimit: vi.fn(), players: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/env", () => ({ env: () => ({ OWNER_DISCORD_ID: "owner", APP_URL: "https://dashboard.test" }) }));
vi.mock("@/server/services/recruitTest", async (original) => {
  const actual = await original<typeof import("@/server/services/recruitTest")>();
  return {
    ...actual,
    recruitTestPlayers: mocks.players,
    sendRecruitTest: mocks.send,
  };
});

import { GET, POST } from "@/app/api/admin/recruit-test/route";

const context = { params: Promise.resolve({}) };
const owner = { discordId: "owner", isAdmin: true, csrfToken: "csrf", displayName: "Owner" };
const input = { steamId: "76561198000000001", requestId: "123e4567-e89b-42d3-a456-426614174000", previewDigest: "a".repeat(64) };
const get = () => new NextRequest("https://dashboard.test/api/admin/recruit-test");
const post = (body: unknown, csrf = "csrf") => new NextRequest("https://dashboard.test/api/admin/recruit-test", {
  method: "POST",
  headers: { origin: "https://dashboard.test", "x-csrf-token": csrf, "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rateLimit.mockResolvedValue(0);
  mocks.session.mockResolvedValue(owner);
  mocks.players.mockResolvedValue({ players: [] });
  mocks.send.mockResolvedValue({ ok: true });
});

describe("admin recruit test route", () => {
  it("only lets the owner list or send test messages", async () => {
    mocks.session.mockResolvedValue({ ...owner, discordId: "other-staff" });
    expect((await GET(get(), context)).status).toBe(404);
    expect((await POST(post(input), context)).status).toBe(404);
    expect(mocks.players).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("requires CSRF protection and rejects malformed targets", async () => {
    expect((await POST(post(input, "bad"), context)).status).toBe(403);
    expect((await POST(post({ ...input, steamId: "bad" }), context)).status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("lists connected players and sends a valid request for the owner", async () => {
    expect((await GET(get(), context)).status).toBe(200);
    expect((await POST(post(input), context)).status).toBe(200);
    expect(mocks.players).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledWith(input, owner);
  });

  it("does not allow a mutation while viewing as another member", async () => {
    mocks.session.mockResolvedValue({ ...owner, viewingAs: { adminId: "owner", adminName: "Owner" } });
    expect((await POST(post(input), context)).status).toBe(403);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
