import { beforeEach, expect, it, vi } from "vitest";
import { getRoster } from "@/server/services/rosters";
import { getGuildMembers, postMessage } from "@/server/services/discord";
import { messagePayload, remindPending, renderRosterMessages } from "@/server/services/rosterPublish";
import type { Roster } from "@/lib/rosterTypes";
import type { RaidHelperEventDetail } from "@/server/services/raidHelper";
import type { Session } from "@/lib/session";

vi.mock("@/lib/db", () => ({ query: vi.fn(), tx: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: () => ({ APP_URL: "https://example.com", DISCORD_GUILD_ID: "guild" }) }));
vi.mock("@/server/services/rosters", () => ({ getRoster: vi.fn() }));
vi.mock("@/server/services/discord", () => ({ getGuildMembers: vi.fn(), postMessage: vi.fn() }));

const actor = { discordId: "100000000000000009", displayName: "Admin" } as Session;
const memberId = "100000000000000001";
const merc = { discordId: null, mercenaryId: "c1ecdb8d-58b2-40d2-8a69-b69a2c291b17", displayName: "Guest", avatarUrl: null, isLeader: false };
const roster = (includeMember: boolean): Roster => ({
  id: `test-${includeMember}`, eventId: "event", eventType: "weekly", templateKey: null,
  settings: { warnUnregistered: true }, status: "published", version: 1, lastEditorId: actor.discordId, updatedAt: new Date().toISOString(),
  squads: [{ id: "squad", name: "Squad", category: "INFANTRY", size: 2, leaderRequired: false,
    slots: [merc, includeMember ? { discordId: memberId, displayName: "Old name", avatarUrl: null, isLeader: false } : null] }],
  responses: {}, messages: [{ partIndex: 0, channelId: "channel", messageId: "message", publishedAt: new Date().toISOString(), updatedAt: null }],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getGuildMembers).mockResolvedValue({ stale: false, fetchedAt: new Date().toISOString(), data: [
    { id: memberId, displayName: "Current nickname", username: "member", avatarUrl: "", roles: [] },
  ] });
  vi.mocked(postMessage).mockResolvedValue("reminder");
});

it("refreshes member nicknames while preserving a mercenary's manually entered name", async () => {
  const [message] = await renderRosterMessages(roster(true), { title: "Event", startTime: null } as RaidHelperEventDetail);
  expect(message!.embed.fields[0]!.value).toContain("☠️ Guest");
  expect(message!.embed.fields[0]!.value).toContain("Current nickname");
  const payload = messagePayload(message!, "roster", 0, true);
  expect(payload.allowed_mentions.users).toEqual([memberId]);
  expect(payload.components).toHaveLength(1);
});

it("removes confirmation buttons and old ping content when a post has only mercenaries", async () => {
  const [message] = await renderRosterMessages(roster(false), { title: "Event", startTime: null } as RaidHelperEventDetail);
  const payload = messagePayload(message!, "roster", 0, false);
  expect(payload.components).toEqual([]);
  expect(payload.content).toBe("");
  expect(message!.embed.footer?.text).toContain("0 pending");
});

it("reminds only Discord members and excludes mercenaries from the pending count", async () => {
  vi.mocked(getRoster).mockResolvedValue(roster(true));
  expect(await remindPending("event", actor)).toEqual({ ok: true, reminded: 1 });
  expect(postMessage).toHaveBeenCalledWith("channel", expect.objectContaining({ allowed_mentions: { parse: [], users: [memberId] } }));
});

it("does not post reminders for a mercenary-only roster", async () => {
  vi.mocked(getRoster).mockResolvedValue(roster(false));
  await expect(remindPending("event", actor)).rejects.toMatchObject({ code: "nobody_pending" });
  expect(postMessage).not.toHaveBeenCalled();
});
