import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ query: vi.fn(), member: vi.fn(), create: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/env", () => ({ env: () => ({ APP_URL: "https://example.com", DISCORD_ALLOWED_ROLE_IDS: ["staff"],
  DISCORD_MEMBER_ROLE_ID: "member", DISCORD_MEMBERS_VIEWER_ROLE_ID: "viewer", DISCORD_ROSTER_ROLE_ID: "1349701919118983239" }) }));
vi.mock("@/lib/session", () => ({ createSession: mocks.create, sessionCookieOptions: () => ({ path: "/" }),
  SESSION_COOKIE: "session", STATE_COOKIE: "state" }));
vi.mock("@/server/services/discord", async (original) => {
  const actual = await original<typeof import("@/server/services/discord")>();
  return { ...actual, exchangeCode: async () => "token", fetchOwnGuildMember: mocks.member };
});

import { GET } from "@/app/welcome/discord/route";
const request = () => new NextRequest("https://example.com/welcome/discord?code=code&state=state", { headers: { cookie: "state=state" } });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue([{ state: "state" }]);
  mocks.create.mockResolvedValue({ token: "session", expires: new Date("2030-01-01") });
  mocks.audit.mockResolvedValue(undefined);
});

describe("roster manager login", () => {
  it("accepts a user holding only the roster role", async () => {
    mocks.member.mockResolvedValue({ id: "123", displayName: "Player", roles: ["1349701919118983239"] });
    const response = await GET(request());
    expect(response.headers.get("location")).toBe("https://example.com/today");
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("still denies a user without an authorized role", async () => {
    mocks.member.mockResolvedValue({ id: "123", displayName: "Player", roles: [] });
    const response = await GET(request());
    expect(response.headers.get("location")).toBe("https://example.com/login?error=forbidden");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
