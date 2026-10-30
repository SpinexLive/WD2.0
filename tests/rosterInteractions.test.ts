import { beforeEach, expect, it, vi } from "vitest";
import { after, NextRequest } from "next/server";
import { POST } from "@/app/api/discord/interactions/route";
import { finishRosterInteraction } from "@/server/services/rosterInteractions";
import { handleRosterButton, verifyDiscordSignature } from "@/server/services/rosterResponses";
import { requestJson } from "@/lib/http";

vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: vi.fn() }));
vi.mock("@/server/services/rosterResponses", () => ({ handleRosterButton: vi.fn(), verifyDiscordSignature: vi.fn() }));
vi.mock("@/server/services/rosterPublish", () => ({ BUTTON_PREFIX: "wdr" }));
vi.mock("@/server/services/scoutingDiscord", () => ({ FEEDBACK_BUTTON: "feedback", FEEDBACK_MODAL: "modal", handleFeedbackRaw: vi.fn() }));
vi.mock("@/lib/http", () => ({ requestJson: vi.fn() }));

const interaction = { type: 3, application_id: "123", token: "test-token", data: { custom_id: "wdr:roster:accept" }, user: { id: "456" } };
const request = () => new NextRequest("http://localhost/api/discord/interactions", { method: "POST", body: JSON.stringify(interaction) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(verifyDiscordSignature).mockReturnValue(true);
  vi.mocked(requestJson).mockResolvedValue({ status: 200, data: {} });
});

it("acknowledges before starting any roster work, then completes the deferred update", async () => {
  vi.mocked(handleRosterButton).mockResolvedValue({ type: 7, data: { embeds: [{ title: "Roster" }] } });
  const response = await POST(request());
  expect(await response.json()).toEqual({ type: 6 });
  expect(handleRosterButton).not.toHaveBeenCalled();
  const finish = vi.mocked(after).mock.calls[0]![0] as () => Promise<void>;
  await finish();
  expect(requestJson).toHaveBeenCalledWith(expect.objectContaining({
    method: "PATCH", url: expect.stringContaining("/messages/@original"),
    body: { embeds: [{ title: "Roster" }], allowed_mentions: { parse: [] } },
  }));
});

it("delivers validation messages privately without replacing the roster", async () => {
  vi.mocked(handleRosterButton).mockResolvedValue({ type: 4, data: { content: "You are not assigned a spot in this roster.", flags: 64 } });
  await finishRosterInteraction(interaction);
  expect(requestJson).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", body: expect.objectContaining({ flags: 64 }) }));
});

it("delivers a private error if saving fails", async () => {
  vi.mocked(handleRosterButton).mockRejectedValue(new Error("Database unavailable"));
  await finishRosterInteraction(interaction);
  expect(requestJson).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ content: "Something went wrong. Please try again.", flags: 64 }) }));
});

it("rejects invalid signatures without scheduling work", async () => {
  vi.mocked(verifyDiscordSignature).mockReturnValue(false);
  expect((await POST(request())).status).toBe(401);
  expect(after).not.toHaveBeenCalled();
});
