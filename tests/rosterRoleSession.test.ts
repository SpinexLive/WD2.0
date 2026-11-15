import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), member: vi.fn(), cookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/env", () => ({ isProduction: false, env: () => ({
  SESSION_SECRET: "a".repeat(32), DISCORD_ALLOWED_ROLE_IDS: ["staff"], DISCORD_MEMBER_ROLE_ID: "member",
  DISCORD_MEMBERS_VIEWER_ROLE_ID: "viewer", DISCORD_ROSTER_ROLE_ID: "1349701919118983239", DISCORD_REVIEWER_ROLE_ID: "reviewer",
}) }));
vi.mock("@/server/services/discord", async (original) => {
  const actual = await original<typeof import("@/server/services/discord")>();
  return { ...actual, fetchGuildMember: mocks.member };
});

import { getSession } from "@/lib/session";
const role = "1349701919118983239";
const row = (roles: string[]) => ({ id: "hash", discord_id: "123", username: "user", display_name: "User", avatar_url: "", csrf_token: "csrf", roles, stale_ms: 301000 });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.cookies.mockResolvedValue({ get: () => ({ value: "token" }) });
  mocks.query.mockImplementation(async (sql: string) => sql.includes("SELECT id, discord_id") ? [row([role])] : []);
});

describe("roster role session revalidation", () => {
  it("allows a role-only user and revalidates their Discord role", async () => {
    mocks.member.mockResolvedValue({ roles: [role], displayName: "User", avatarUrl: "" });
    const session = await getSession();
    expect(session).toMatchObject({ isAdmin: false, canManageRosters: true });
    expect(mocks.member).toHaveBeenCalledWith("123");
  });

  it("removes roster access when the role is lost but another sign-in role remains", async () => {
    mocks.member.mockResolvedValue({ roles: ["member"], displayName: "User", avatarUrl: "" });
    expect(await getSession()).toMatchObject({ isAdmin: false, canManageRosters: false });
  });

  it("revokes the session when the user has no remaining authorized role", async () => {
    mocks.member.mockResolvedValue({ roles: [], displayName: "User", avatarUrl: "" });
    expect(await getSession()).toBeNull();
    expect(mocks.query).toHaveBeenCalledWith("DELETE FROM sessions WHERE discord_id = $1", ["123"]);
  });
});
