import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(), members: vi.fn(), league: vi.fn(), sql: vi.fn(), audit: vi.fn(), invalidate: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ env: () => ({ DISCORD_GUILD_ID: "100", DISCORD_BOT_TOKEN: "token", DISCORD_MEMBER_ROLE_ID: "clan" }) }));
vi.mock("@/lib/http", async (original) => ({ ...await original<typeof import("@/lib/http")>(), requestJson: mocks.request }));
vi.mock("@/lib/db", () => ({ query: mocks.sql, tx: (fn: (client: unknown) => unknown) => fn({ query: mocks.sql }) }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/cache", () => ({ invalidate: mocks.invalidate }));
vi.mock("@/server/services/discord", () => ({ getGuildMembers: mocks.members }));
vi.mock("@/server/services/wardogsLeague", () => ({ getLeagueMembers: mocks.league }));

import { assignableWdlRoles, syncWdlRole, wdlRoleRecipients } from "@/server/services/wdlRole";
import type { DiscordMember } from "@/server/services/discord";
import type { LeagueMember } from "@/server/services/wardogsLeague";
import { ProviderError } from "@/lib/http";

const member = (id: string, roles = ["clan"], bot = false): DiscordMember => ({ id, roles, bot, displayName: id, username: id, avatarUrl: "" });
const registered = (discordId: string): LeagueMember => ({ discordId, name: null, role: null, joinedAt: null });
const actor = { discordId: "owner", displayName: "Owner" };
const role = (id: string, position: number, managed = false, permissions = "0") => ({ id, name: id, position, managed, permissions });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.sql.mockImplementation(async (sql: string) => {
    if (sql.includes("pg_try_advisory")) return { rows: [{ locked: true }] };
    if (sql.startsWith("SELECT role_id")) return { rows: [{ role_id: "200" }] };
    return { rows: [] };
  });
  mocks.request.mockImplementation(async ({ url }: { url: string }) => {
    if (url.endsWith("/roles")) return { data: [role("100", 0), role("150", 5, true, String(1n << 28n)), role("200", 2), role("300", 6), role("400", 1, true)] };
    if (url.endsWith("/users/@me")) return { data: { id: "bot" } };
    if (url.endsWith("/members/bot")) return { data: { roles: ["150"] } };
    return { status: 204, data: null };
  });
  mocks.members.mockResolvedValue({ stale: false, data: [member("alice"), member("bob", ["clan", "200"]), member("outsider", []), member("pending")] });
  mocks.league.mockResolvedValue({ stale: false, data: [registered("alice"), registered("bob"), registered("outsider")] });
});

describe("WDL role assignment", () => {
  it("qualifies only registered clan members without the role, excluding bots", () => {
    expect(wdlRoleRecipients([member("a"), member("b", ["clan", "200"]), member("c", []), member("d"), member("bot", ["clan"], true)],
      [registered("a"), registered("b"), registered("c"), registered("bot")], "200", "clan").map((m) => m.id)).toEqual(["a"]);
  });
  it("excludes managed roles, everyone and roles above the bot", async () => {
    expect(await assignableWdlRoles()).toEqual([{ id: "200", name: "200" }]);
  });
  it("adds only missing roles and invalidates member data", async () => {
    expect(await syncWdlRole(actor)).toEqual({ ok: true, added: 1, error: null });
    const writes = mocks.request.mock.calls.filter(([opts]) => opts.method === "PUT");
    expect(writes).toHaveLength(1);
    expect(writes[0]![0].url).toContain("/members/alice/roles/200");
    expect(mocks.invalidate).toHaveBeenCalledWith("discord:guild-members");
  });
  it.each(["members", "league"] as const)("does not assign roles when %s data is stale", async (source) => {
    mocks[source].mockResolvedValue({ stale: true, data: [] });
    expect(await syncWdlRole(actor)).toMatchObject({ ok: false, added: 0, error: expect.stringContaining("outdated") });
    expect(mocks.request.mock.calls.some(([opts]) => opts.method === "PUT")).toBe(false);
  });
  it("persists permission errors for the admin panel", async () => {
    mocks.request.mockImplementation(async ({ url, method }: { url: string; method?: string }) => {
      if (method === "PUT") throw new ProviderError("discord", "Forbidden", 403, false, "50013");
      if (url.endsWith("/roles")) return { data: [role("100", 0), role("150", 5, true, String(1n << 28n)), role("200", 2)] };
      if (url.endsWith("/users/@me")) return { data: { id: "bot" } };
      return { data: { roles: ["150"] } };
    });
    const result = await syncWdlRole(actor);
    expect(result).toMatchObject({ ok: false, added: 0, error: expect.stringContaining("Manage Roles") });
    expect(mocks.sql).toHaveBeenCalledWith(expect.stringContaining("last_error = $2"), [0, result.error]);
  });
  it("makes no Discord calls when disabled", async () => {
    mocks.sql.mockImplementation(async (sql: string) => ({ rows: sql.includes("pg_try_advisory") ? [{ locked: true }] : [{ role_id: null }] }));
    expect(await syncWdlRole(actor)).toMatchObject({ disabled: true, added: 0 });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("does not overlap another sync", async () => {
    mocks.sql.mockResolvedValue({ rows: [{ locked: false }] });
    await expect(syncWdlRole(actor)).rejects.toThrow("already running");
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
