import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ session: vi.fn(), rate: vi.fn(), status: vi.fn(), log: vi.fn(), enable: vi.fn(), disable: vi.fn(), link: vi.fn(), scheduled: vi.fn(), retry: vi.fn(), remove: vi.fn(), preview: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: mocks.rate }));
vi.mock("@/lib/env", () => ({ env: () => ({ OWNER_DISCORD_ID: "owner", APP_URL: "https://dashboard.test" }) }));
vi.mock("@/server/services/wdlRaid", () => ({
  wdlRaidStatus: mocks.status, wdlCreatedEventLog: mocks.log, enableWdlRaidAutomation: mocks.enable, disableWdlRaidAutomation: mocks.disable, linkExistingWdlEvent: mocks.link,
  recoverScheduledWdlEvent: mocks.scheduled, deleteReviewedWdlEvent: mocks.remove,
  retryReviewedWdlFixture: mocks.retry,
  previewWdlEventDescription: mocks.preview, applyWdlEventDescription: mocks.update,
}));

import { GET, POST } from "@/app/api/admin/wdl-fixtures/route";
import { GET as GET_LOG } from "@/app/api/admin/wdl-fixtures/events/route";
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
  mocks.log.mockResolvedValue({ events: [], nextCursor: null });
  mocks.enable.mockResolvedValue({ enabled: true });
});

describe("WDL Admin automation route", () => {
  it("only lets the owner read status or enable automation", async () => {
    mocks.session.mockResolvedValue({ ...owner, discordId: "other" });
    expect((await GET(get(), context)).status).toBe(404);
    expect((await POST(post({ action: "enable" }), context)).status).toBe(404);
    expect(mocks.enable).not.toHaveBeenCalled();
  });
  it("enforces CSRF, read-only view-as, and action validation", async () => {
    expect((await POST(post({ action: "enable" }, "wrong"), context)).status).toBe(403);
    expect((await POST(post({ action: "test" }), context)).status).toBe(400);
    mocks.session.mockResolvedValue({ ...owner, viewingAs: { adminId: "owner", adminName: "Owner" } });
    expect((await POST(post({ action: "enable" }), context)).status).toBe(403);
    expect(mocks.enable).not.toHaveBeenCalled();
  });
  it("enables only when the owner posts the action", async () => {
    expect((await GET(get(), context)).status).toBe(200);
    expect(mocks.enable).not.toHaveBeenCalled();
    expect((await POST(post({ action: "enable" }), context)).status).toBe(200);
    expect(mocks.enable).toHaveBeenCalledWith(owner);
  });

  it("restricts preview and update to the owner with CSRF and a valid preview version", async () => {
    const update = { action: "update-description", fixtureId: "fixture", version: "a".repeat(64) };
    mocks.session.mockResolvedValue({ ...owner, discordId: "other" });
    expect((await POST(post({ action: "preview-description", fixtureId: "fixture" }), context)).status).toBe(404);
    expect((await POST(post(update), context)).status).toBe(404);
    mocks.session.mockResolvedValue(owner);
    expect((await POST(post(update, "wrong"), context)).status).toBe(403);
    expect((await POST(post({ ...update, version: "invalid" }), context)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.preview.mockResolvedValue({ version: update.version });
    mocks.update.mockResolvedValue({ enabled: true });
    expect((await POST(post({ action: "preview-description", fixtureId: "fixture" }), context)).status).toBe(200);
    expect((await POST(post(update), context)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith("fixture", update.version, owner);
  });

  it("restricts the event ID log to the owner and validates pagination", async () => {
    const logRequest = (suffix = "") => new NextRequest(`https://dashboard.test/api/admin/wdl-fixtures/events${suffix}`);
    mocks.session.mockResolvedValue({ ...owner, discordId: "other" });
    expect((await GET_LOG(logRequest(), context)).status).toBe(404);
    mocks.session.mockResolvedValue(owner);
    expect((await GET_LOG(logRequest("?before=abc"), context)).status).toBe(400);
    expect((await GET_LOG(logRequest("?before=9223372036854775808"), context)).status).toBe(400);
    expect((await GET_LOG(logRequest("?before=0"), context)).status).toBe(400);
    expect((await GET_LOG(logRequest("?before=51"), context)).status).toBe(200);
    expect(mocks.log).toHaveBeenCalledWith("51");
    expect((await GET_LOG(logRequest(), context)).status).toBe(200);
    expect(mocks.log).toHaveBeenCalledWith(null);
  });
});
