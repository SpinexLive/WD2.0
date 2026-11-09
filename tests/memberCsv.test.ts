import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ session: vi.fn(), limit: vi.fn(), members: vi.fn(), links: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: mocks.limit }));
vi.mock("@/lib/env", () => ({ env: () => ({ OWNER_DISCORD_ID: "owner", APP_URL: "https://dashboard.test" }) }));
vi.mock("@/server/services/discord", () => ({ getClanMembers: mocks.members }));
vi.mock("@/server/services/links", () => ({ resolveLinks: mocks.links }));

import { GET } from "@/app/api/members/export/route";
import { memberCsv } from "@/lib/memberCsv";

const request = () => new NextRequest("https://dashboard.test/api/members/export");
const context = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.limit.mockResolvedValue(0);
  mocks.session.mockResolvedValue({ discordId: "owner", isAdmin: true });
  mocks.members.mockResolvedValue({
    stale: false,
    data: [
      { id: "1", displayName: "❖ Fjolle", username: "discord.user" },
      { id: "2", displayName: "Second", username: "other.user" },
    ],
  });
  mocks.links.mockResolvedValue({
    steamIds: new Map([["1", "76561198000000001"]]),
    source: { available: true, stale: false },
  });
});

describe("member CSV export", () => {
  it("quotes CSV fields, preserves newlines and neutralizes spreadsheet formulas", () => {
    expect(memberCsv([{ displayName: 'Name, "quoted"\nline', username: " =SUM(1,2)", steamId: null }]))
      .toBe('name,discord_name,steam_id\r\n"Name, ""quoted""\nline","\' =SUM(1,2)",""\r\n');
  });

  it("returns all members with the requested columns and exact Steam IDs", async () => {
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toBe(
      'name,discord_name,steam_id\r\n"❖ Fjolle","discord.user","76561198000000001"\r\n"Second","other.user",""\r\n',
    );
    expect(mocks.members).toHaveBeenCalledWith(true);
    expect(mocks.links).toHaveBeenCalledWith(true);
  });

  it("refuses other staff, viewers, and unsigned users without fetching data", async () => {
    for (const [session, status] of [
      [{ discordId: "other", isAdmin: true }, 404],
      [{ discordId: "viewer", isAdmin: false, canViewMembers: true }, 403],
      [null, 401],
    ] as const) {
      mocks.session.mockResolvedValue(session);
      expect((await GET(request(), context)).status).toBe(status);
    }
    expect(mocks.members).not.toHaveBeenCalled();
    expect(mocks.links).not.toHaveBeenCalled();
  });

  it("refuses to present stale or unavailable source data as complete", async () => {
    mocks.members.mockResolvedValueOnce({ stale: true, data: [] });
    expect((await GET(request(), context)).status).toBe(503);
    mocks.links.mockResolvedValueOnce({ steamIds: new Map(), source: { available: false, stale: false } });
    expect((await GET(request(), context)).status).toBe(503);
    mocks.links.mockResolvedValueOnce({ steamIds: new Map(), source: { available: true, stale: true } });
    expect((await GET(request(), context)).status).toBe(503);
  });
});
