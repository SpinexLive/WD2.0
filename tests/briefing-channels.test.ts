import { describe, expect, it } from "vitest";
import { buildBriefingChannelOverwrites, formatBriefingChannelName, nextLondonMidnight } from "../src/lib/briefingChannels";

describe("briefing channel names", () => {
  it("adds the requested prefix and formats names in small caps", () => {
    expect(formatBriefingChannelName("Wardogs Infantry")).toBe("🔊┊ᴡᴀʀᴅᴏɢꜱ-ɪɴꜰᴀɴᴛʀʏ");
  });

  it("keeps the prefix singular and rejects names without usable characters", () => {
    expect(formatBriefingChannelName("🔊┊Example Squad")).toBe("🔊┊ᴇxᴀᴍᴘʟᴇ-ꜱǫᴜᴀᴅ");
    expect(formatBriefingChannelName("🔊┊---")).toBe("");
  });
});

describe("briefing channel cleanup time", () => {
  it("schedules deletion at the next London midnight, including summer time", () => {
    expect(nextLondonMidnight(Date.parse("2026-11-08T17:42:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(nextLondonMidnight(Date.parse("2026-06-30T12:00:00Z")).toISOString()).toBe("2026-06-30T23:00:00.000Z");
  });
});

describe("briefing channel permissions", () => {
  it("limits visibility to the clan role and bot, including roles with server-level visibility", () => {
    const overwrites = buildBriefingChannelOverwrites("guild", "clan", "bot", [
      { id: "guild", permissions: "1024" },
      { id: "clan", permissions: "0" },
      { id: "staff", permissions: "1024" },
      { id: "member", permissions: "0" },
    ]);

    expect(overwrites).toEqual([
      { id: "guild", type: 0, allow: "0", deny: "1024" },
      { id: "staff", type: 0, allow: "0", deny: "1024" },
      { id: "clan", type: 0, allow: "1049600", deny: "0" },
      { id: "bot", type: 1, allow: "1049600", deny: "0" },
    ]);
  });
});
