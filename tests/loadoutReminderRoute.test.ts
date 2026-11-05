import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ session: vi.fn(), rateLimit: vi.fn(), preview: vi.fn(), send: vi.fn(), table: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/env", () => ({ env: () => ({ OWNER_DISCORD_ID: "owner", APP_URL: "https://dashboard.test" }) }));
vi.mock("@/server/services/loadout", () => ({ loadoutTable: mocks.table }));
vi.mock("@/server/services/loadoutReminder", async (original) => {
  const actual = await original<typeof import("@/server/services/loadoutReminder")>();
  return { ...actual, previewLoadoutReminder: mocks.preview, sendLoadoutReminder: mocks.send };
});

import { GET as getTable } from "@/app/api/loadout/route";
import { GET, POST } from "@/app/api/loadout/remind/route";

const context = { params: Promise.resolve({}) };
const owner = { discordId: "owner", isAdmin: true, csrfToken: "csrf", displayName: "Owner" };
const input = { previewDigest: "a".repeat(64), requestId: "123e4567-e89b-42d3-a456-426614174000" };
const get = () => new NextRequest("https://dashboard.test/api/loadout/remind");
const post = (body: unknown, csrf = "csrf") => new NextRequest("https://dashboard.test/api/loadout/remind", {
  method: "POST", headers: { origin: "https://dashboard.test", "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue(owner);
  mocks.rateLimit.mockResolvedValue(0);
  mocks.table.mockResolvedValue({ config: null, members: [] });
  mocks.preview.mockResolvedValue({ count: 1, previewDigest: input.previewDigest, trackerUrl: null });
  mocks.send.mockResolvedValue({ ok: true, reminded: 1 });
});

describe("owner-only loadout reminder routes", () => {
  it("only exposes the button and reminder endpoints to the owner", async () => {
    expect((await (await getTable(get(), context)).json()).canSendReminder).toBe(true);
    mocks.session.mockResolvedValue({ ...owner, discordId: "other-staff" });
    expect((await (await getTable(get(), context)).json()).canSendReminder).toBe(false);
    expect((await GET(get(), context)).status).toBe(404);
    expect((await POST(post(input), context)).status).toBe(404);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("enforces authentication, CSRF, view-as and valid input", async () => {
    mocks.session.mockResolvedValueOnce(null);
    expect((await GET(get(), context)).status).toBe(401);
    expect((await POST(post(input, "bad"), context)).status).toBe(403);
    expect((await POST(post({ ...input, previewDigest: "bad" }), context)).status).toBe(400);
    mocks.session.mockResolvedValue({ ...owner, viewingAs: { adminId: "owner", adminName: "Owner" } });
    expect((await (await getTable(get(), context)).json()).canSendReminder).toBe(false);
    expect((await POST(post(input), context)).status).toBe(403);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("lets the owner preview and send the validated request", async () => {
    expect((await GET(get(), context)).status).toBe(200);
    expect((await POST(post(input), context)).status).toBe(200);
    expect(mocks.preview).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledWith(input, owner);
  });
});
