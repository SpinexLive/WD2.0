import { beforeAll, describe, expect, it } from "vitest";
import { channelName, parseGoldPrice } from "@/server/services/gold";
import { mergeBoards } from "@/lib/leaderboardMerge";
import { TOLERANCE } from "@/server/services/recruit";
import type { LeaderboardRow } from "@/server/services/wardogsRcon";

beforeAll(() => {
  Object.assign(process.env, {
    DISCORD_CLIENT_ID: "1", DISCORD_CLIENT_SECRET: "s", DISCORD_BOT_TOKEN: "t", DISCORD_GUILD_ID: "1332320879073296404",
    DISCORD_ALLOWED_ROLE_IDS: "1349704360816414762,1546188874986950758", DISCORD_MEMBER_ROLE_ID: "1546184733174669424",
    RAID_HELPER_API_TOKEN: "r", WARDOGS_API_KEY: "w", TOURNAMENT_API_KEY: "k", DATABASE_URL: "postgres://x",
    SESSION_SECRET: "x".repeat(40), APP_URL: "http://localhost:3000",
  });
});

describe("gold price parsing", () => {
  const html = `<meta name="description" content="One WARDOGS gold bar costs $641,905 on 27 October 2026."><script>[{"date":"2026-10-26","rate":630000},{"date":"2026-10-27","rate":641905}]</script>`;
  it("reads the embedded series for the requested day", () => {
    expect(parseGoldPrice(html, "2026-10-27")).toEqual({ date: "2026-10-27", rate: 641905 });
    expect(parseGoldPrice(html, "2026-10-26")?.rate).toBe(630000);
  });
  it("falls back to the meta description", () => {
    expect(parseGoldPrice('costs $12,345 on 27 October 2026.', "2026-10-27")?.rate).toBe(12345);
  });
  it("returns null when the day isn't published yet", () => {
    expect(parseGoldPrice(html, "2026-10-28")).toBeNull();
  });
  it("builds the channel name with the prefix", () => {
    expect(channelName(641905)).toBe("┊🪙┊Gold Bar $641,905");
  });
});

const row = (steamId: string, over: Partial<LeaderboardRow>): LeaderboardRow => ({ rank: 0, steamId, name: steamId, kills: 0, deaths: 1, kd: 0, matches: 1, cash: 0, ...over });

describe("leaderboard merge", () => {
  const clan = (id: string) => id !== "outsider";
  it("keeps clan members only and re-ranks them", () => {
    const out = mergeBoards([[row("outsider", { kills: 999 }), row("a", { kills: 10 }), row("b", { kills: 20 })]], clan, "kills");
    expect(out.map((r) => [r.steamId, r.rank])).toEqual([["b", 1], ["a", 2]]);
  });
  it("prefers the source with more matches per player", () => {
    const out = mergeBoards([[row("a", { kills: 50, matches: 10 })], [row("a", { kills: 80, matches: 14 })]], clan, "kills");
    expect(out[0]!.kills).toBe(80);
  });
  it("hides players under 5 matches when sorting by K/D", () => {
    const out = mergeBoards([[row("lucky", { kd: 9, matches: 1 }), row("steady", { kd: 2, matches: 8 })]], clan, "kd");
    expect(out.map((r) => r.steamId)).toEqual(["steady"]);
  });
});

describe("recruit threshold", () => {
  it("requires 90% of the top-10 average", () => {
    expect(TOLERANCE).toBe(0.9);
  });
});
