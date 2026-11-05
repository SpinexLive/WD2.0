import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ session: vi.fn(), rate: vi.fn(), status: vi.fn(), create: vi.fn(), check: vi.fn(), clear: vi.fn(), approve: vi.fn(), disable: vi.fn(), link: vi.fn(), scheduled: vi.fn(), recover: vi.fn(), retry: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: mocks.rate }));
vi.mock("@/lib/env", () => ({ env: () => ({ OWNER_DISCORD_ID: "owner", APP_URL: "https://dashboard.test" }) }));
vi.mock("@/server/services/wdlRaid", () => ({
  wdlRaidStatus: mocks.status, createWdlRaidTest: mocks.create, checkWdlRaidTest: mocks.check, clearUncertainWdlTest: mocks.clear,
  approveWdlRaidTest: mocks.approve, disableWdlRaidAutomation: mocks.disable, linkExistingWdlEvent: mocks.link,
  recoverScheduledWdlEvent: mocks.scheduled, recoverWdlRaidTest: mocks.recover, deleteReviewedWdlEvent: mocks.remove,
  retryReviewedWdlFixture: mocks.retry,
}));

import { GET, POST } from "@/app/api/admin/wdl-fixtures/route";
const owner = { discordId: "owner", isAdmin: true, csrfToken: "csrf", displayName: "Owner" };
const context = { params: Promise.resolve({}) };
const get = () => new NextRequest("https://dashboard.test/api/admin/wdl-fixtures");
const post = (body: unknown, csrf = "csrf") => new NextRequest("https://dashboard.test/api/admin/wdl-fixtures", {
  method: "POST", headers: { origin: "https://dashboard.test", "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue(owner);
  mocks.rate.mockResolvedValue(0);
  mocks.status.mockResolvedValue({ enabled: false });
  mocks.create.mockResolvedValue({ enabled: false });
});

describe("WDL Admin test route", () => {
  it("only lets the owner read status or schedule a test", async () => {
    mocks.session.mockResolvedValue({ ...owner, discordId: "other" });
    expect((await GET(get(), context)).status).toBe(404);
    expect((await POST(post({ action: "test" }), context)).status).toBe(404);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("enforces CSRF, read-only view-as, and action validation", async () => {
    expect((await POST(post({ action: "test" }, "wrong"), context)).status).toBe(403);
    expect((await POST(post({ action: "approve", testId: "invalid" }), context)).status).toBe(400);
    mocks.session.mockResolvedValue({ ...owner, viewingAs: { adminId: "owner", adminName: "Owner" } });
    expect((await POST(post({ action: "test" }), context)).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("only sends the test after the owner posts the action", async () => {
    expect((await GET(get(), context)).status).toBe(200);
    expect(mocks.create).not.toHaveBeenCalled();
    expect((await POST(post({ action: "test" }), context)).status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(owner);
  });
});
