import { expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import { getEvents } from "@/server/services/raidHelper";
import { postMessage } from "@/server/services/discord";
import { postFeedbackPrompt } from "@/server/services/scoutingDiscord";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: () => ({ APP_URL: "https://dashboard.example" }) }));
vi.mock("@/server/services/raidHelper", () => ({ getEvents: vi.fn() }));
vi.mock("@/server/services/discord", () => ({ postMessage: vi.fn(), deleteMessage: vi.fn(), editMessage: vi.fn(), hasAuthorisedRole: vi.fn() }));

it("refreshes a renamed event when posting feedback while preserving the configured teams", async () => {
  vi.mocked(query).mockResolvedValueOnce([{
    event_id: "match", title: "⚔️ RMNT v RCNE v Greyhounds",
    team_a: "RCNE", team_b: "KOD", closed_at: null,
    faction_a: null, faction_b: null, prompt_channel_id: null, prompt_message_id: null,
  }]).mockResolvedValue([]);
  vi.mocked(getEvents).mockResolvedValue({
    data: [{ id: "match", title: "⚔️ RMNT v RCNE v KOD", channelId: "channel", startTime: null, signupCount: null, status: "past", discordUrl: null, description: null }],
    fetchedAt: new Date().toISOString(), stale: false,
  });
  vi.mocked(postMessage).mockResolvedValue("message");

  await postFeedbackPrompt("match");

  expect(getEvents).toHaveBeenCalledWith(true);
  expect(postMessage).toHaveBeenCalledWith("channel", expect.objectContaining({
    embeds: [expect.objectContaining({ description: expect.stringContaining("**⚔️ RMNT v RCNE v KOD**"), fields: [{ name: "Opposing teams", value: "RCNE\nKOD" }] })],
    components: [expect.objectContaining({ components: expect.arrayContaining([
      expect.objectContaining({ label: "Feedback: RCNE" }),
      expect.objectContaining({ label: "Feedback: KOD" }),
    ]) })],
  }));
  expect(query).toHaveBeenCalledWith("UPDATE scouting_events SET title = $2 WHERE event_id = $1", ["match", "⚔️ RMNT v RCNE v KOD"]);
});
