import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/env", () => ({
  env: () => ({ RAID_HELPER_BASE_URL: "https://raid-helper.dev", RAID_HELPER_API_TOKEN: "test",
    DISCORD_GUILD_ID: "guild", DISCORD_BOT_TOKEN: "bot" }),
}));
vi.mock("@/lib/http", async (original) => {
  const actual = await original<typeof import("@/lib/http")>();
  return { ...actual, requestJson: mocks.request };
});

import { deleteLeagueRaidEvent, otherLeagueSettingsUnchanged, prepareLeagueRoleRename, renameLeagueRole } from "@/server/services/leagueRaidHelper";

describe("Raid Helper event deletion", () => {
  beforeEach(() => vi.resetAllMocks());

  it("accepts the verified scheduled-event deletion response", async () => {
    mocks.request.mockResolvedValue({ data: { status: "Event deleted" } });
    await expect(deleteLeagueRaidEvent("1376958958463357068-1")).resolves.toBeUndefined();
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
      method: "DELETE", url: "https://raid-helper.dev/api/v4/events/1376958958463357068-1", retries: 0,
    }));
  });

  describe("GWL temporary role updates", () => {
    const oldName = "GWL | RMNT v TLL v ???";
    const newName = "GWL | RMNT v TLL v ABC";
    const roleId = "1573034940067483668";
    const event = (id: string, name = oldName, role = roleId) => ({
      id, serverId: "guild", channelId: "channel", title: oldName, templateId: "ct34", startTime: 123,
      advancedSettings: { temp_role: name }, temporaryRole: role,
    });
    const role = { id: roleId, name: oldName, managed: false };

    function responses(roles = [role], other?: ReturnType<typeof event>, original: Record<string, unknown> = event("event1")) {
      mocks.request.mockImplementation(async ({ url, method }: { url: string; method?: string }) => {
        if (url.endsWith("/guilds/guild/roles")) return { data: roles };
        if (url.endsWith("/servers/guild/scheduledevents")) return { data: { scheduledEvents: [] } };
        if (url.endsWith("/servers/guild/events")) return { data: { pages: 1, postedEvents: [
          { id: "event1", channelId: "channel", title: oldName, startTime: 123 },
          ...(other ? [{ id: other.id, channelId: "channel", title: other.title, startTime: 123 }] : []),
        ] } };
        if (url.endsWith("/events/event1")) return { data: original };
        if (other && url.endsWith(`/events/${other.id}`)) return { data: other };
        if (method === "PATCH") return { data: { id: roleId, name: newName } };
        throw new Error(`Unexpected request: ${url}`);
      });
    }

    beforeEach(() => vi.resetAllMocks());

    it("uses the role ID returned by the event and renames that role", async () => {
      responses();
      expect(await prepareLeagueRoleRename("event1", oldName, newName, false)).toBe(roleId);
      await renameLeagueRole(roleId, oldName, newName);
      expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
        method: "PATCH", url: expect.stringContaining(`/roles/${roleId}`), body: { name: newName }, retries: 0,
      }));
    });

    it("rejects ambiguous names and roles referenced by another event", async () => {
      responses([role, { ...role, id: "1573034940067483669" }]);
      await expect(prepareLeagueRoleRename("event1", oldName, newName, false)).rejects.toThrow("could not be verified");
      responses([role, { ...role, id: "1573034940067483669", name: newName }]);
      await expect(prepareLeagueRoleRename("event1", oldName, newName, false)).rejects.toThrow("could not be verified");
      responses([role], event("event2"));
      await expect(prepareLeagueRoleRename("event1", oldName, newName, false)).rejects.toThrow("Another Raid Helper event");
      expect(mocks.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "PATCH" }));
    });

    it("detects unrelated advanced setting changes", () => {
      expect(otherLeagueSettingsUnchanged({ temp_role: oldName, reminder: 60 }, { reminder: 60, temp_role: newName })).toBe(true);
      expect(otherLeagueSettingsUnchanged({ temp_role: oldName, reminder: 60 }, { temp_role: newName, reminder: 0 })).toBe(false);
    });

    it("allows a posted event with no signups and no role yet", async () => {
      responses([], undefined, { ...event("event1"), temporaryRole: undefined, signUps: [] });
      await expect(prepareLeagueRoleRename("event1", oldName, newName, false)).resolves.toBeNull();
      responses([], undefined, { ...event("event1"), temporaryRole: undefined, signUps: [{ userId: "player" }] });
      await expect(prepareLeagueRoleRename("event1", oldName, newName, false)).rejects.toThrow("could not be verified");
    });
  });

  it("does not accept an unrecognised response as confirmation", async () => {
    mocks.request.mockResolvedValue({ data: { status: "pending" } });
    await expect(deleteLeagueRaidEvent("1376958958463357068-1")).rejects.toThrow("did not confirm");
  });
});
