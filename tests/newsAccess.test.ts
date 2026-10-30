import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getSession, type Session } from "@/lib/session";
import { GET, POST } from "@/app/api/news/route";
import { PUT, DELETE } from "@/app/api/news/[id]/route";
import { createNews, listNews, updateNews, deleteNews } from "@/server/services/news";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: () => ({ APP_URL: "https://example.com" }) }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: vi.fn().mockResolvedValue(0) }));
vi.mock("@/server/services/news", async (original) => ({
  ...await original<typeof import("@/server/services/news")>(),
  createNews: vi.fn(), listNews: vi.fn(), updateNews: vi.fn(), deleteNews: vi.fn(),
}));

const session: Session = { id: "session", discordId: "100000000000000001", displayName: "Staff", username: "staff", avatarUrl: "", csrfToken: "csrf", isAdmin: true, isReviewer: false, canManageNews: false };
const id = "c1ecdb8d-58b2-40d2-8a69-b69a2c291b17";
const context = { params: Promise.resolve({ id }) };
const request = (method: string) => new NextRequest("https://example.com/api/news", {
  method, headers: { origin: "https://example.com", "x-csrf-token": "csrf" },
  ...(method === "POST" || method === "PUT" ? { body: JSON.stringify({ title: "News", body: "Body" }) } : {}),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(session);
  vi.mocked(listNews).mockResolvedValue([]);
});

it.each([["GET", GET], ["POST", POST], ["PUT", PUT], ["DELETE", DELETE]] as const)("denies %s to staff without the Prime role", async (method, handler) => {
  expect((await handler(request(method), context)).status).toBe(403);
  expect(listNews).not.toHaveBeenCalled();
  expect(createNews).not.toHaveBeenCalled();
  expect(updateNews).not.toHaveBeenCalled();
  expect(deleteNews).not.toHaveBeenCalled();
});

it.each([["GET", GET], ["POST", POST], ["PUT", PUT], ["DELETE", DELETE]] as const)("allows %s for the Prime role", async (method, handler) => {
  vi.mocked(getSession).mockResolvedValue({ ...session, canManageNews: true });
  expect((await handler(request(method), context)).status).toBe(200);
});

it("does not bypass read-only view-as for news mutations", async () => {
  vi.mocked(getSession).mockResolvedValue({ ...session, canManageNews: true, viewingAs: { adminId: session.discordId, adminName: "Admin" } });
  const response = await POST(request("POST"), context);
  expect(response.status).toBe(403);
  expect((await response.json()).error.code).toBe("view_as_readonly");
});
