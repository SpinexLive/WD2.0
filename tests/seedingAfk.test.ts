import { beforeEach, describe, expect, it, vi } from "vitest";
import { balancedDestination, seedingSettingsSchema } from "@/lib/seedingAfk";

const fake = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>, runtime: {} as Record<string, unknown>,
  registrations: [] as { discord_id: string; steam_id: string; session_id: string; registered_at: Date; next_switch_at: Date; next_reminder_at: Date }[],
  logs: [] as unknown[][],
}));
const snapshot = vi.hoisted(() => vi.fn());
const move = vi.hoisted(() => vi.fn());
const remind = vi.hoisted(() => vi.fn());
const links = vi.hoisted(() => vi.fn());
vi.mock("@/lib/env", () => ({ env: () => ({ DISCORD_GUILD_ID: "guild", GAME_RCON_URL: "http://game", GAME_RCON_PASSWORD: "secret" }) }));
vi.mock("@/server/services/seedingRcon", () => ({ seedingSnapshot: snapshot, moveSeedingPlayer: move, remindSeedingPlayer: remind }));
vi.mock("@/server/services/links", () => ({ resolveLinks: links }));
vi.mock("@/server/services/discord", () => ({ postMessage: vi.fn(), editMessage: vi.fn(), getGuildMembers: vi.fn().mockResolvedValue({ data: [] }) }));
vi.mock("@/lib/db", () => {
  async function run(sql: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> {
    let rows: unknown[] = [];
    if (sql.includes("pg_try_advisory")) rows = [{ acquired: true }];
    else if (sql.includes("pg_advisory")) rows = [];
    else if (sql.startsWith("SELECT") && sql.includes("FROM seeding_afk WHERE")) rows = [{ settings: structuredClone(fake.settings), runtime: structuredClone(fake.runtime) }];
    else if (sql.startsWith("SELECT") && sql.includes("FROM seeding_afk_players")) rows = fake.registrations.filter((p) => !sql.includes("WHERE discord_id") || p.discord_id === params[0]).map((p) => ({ ...p }));
    else if (sql.startsWith("UPDATE seeding_afk SET")) { fake.settings = JSON.parse(params[0] as string); fake.runtime = JSON.parse(params[1] as string); }
    else if (sql.startsWith("INSERT INTO audit_logs")) fake.logs.push(params);
    else if (sql.startsWith("DELETE FROM seeding_afk_players")) {
      const removed = fake.registrations.filter((p) => !sql.includes("WHERE") || (sql.includes("discord_id=$1") ? p.discord_id === params[0] : p.steam_id === params[0]));
      fake.registrations = fake.registrations.filter((p) => !removed.includes(p)); rows = removed;
    } else if (sql.startsWith("UPDATE seeding_afk_players SET next_reminder_at")) {
      rows = fake.registrations.filter((p) => p.discord_id === params[0] && p.session_id === params[1] && p.next_reminder_at.getTime() <= Date.now());
      for (const p of rows as typeof fake.registrations) p.next_reminder_at = new Date(Date.now() + 60_000);
    } else if (sql.startsWith("UPDATE seeding_afk_players")) {
      rows = fake.registrations.filter((p) => (Array.isArray(params[0]) ? params[0].includes(p.discord_id) : p.discord_id === params[0]) && p.session_id === params[2]);
      if (Array.isArray(params[0]) && rows.length !== 2) rows = [];
      for (const p of rows as typeof fake.registrations) p.next_switch_at = new Date(Date.now() + Number(params[1]) * 1000);
    } else if (sql.startsWith("INSERT INTO seeding_afk_players")) {
      if (!fake.registrations.some((p) => p.discord_id === params[0] || p.steam_id === params[1])) {
        const p = { discord_id: String(params[0]), steam_id: String(params[1]), session_id: String(params[2]), registered_at: new Date(), next_switch_at: new Date(Date.now() + Number(params[3]) * 1000), next_reminder_at: new Date() };
        fake.registrations.push(p); rows = [p];
      }
    } else throw new Error(`Unhandled SQL: ${sql}`);
    return { rows, rowCount: rows.length };
  }
  return { query: async (sql: string, params: unknown[]) => (await run(sql, params)).rows,
    independentQuery: async (sql: string, params: unknown[]) => (await run(sql, params)).rows,
    tx: async (fn: (c: unknown) => unknown) => fn({ query: run }) };
});

import { saveSeedingSettings, seedingButton, seedingTick, startSeedingScheduler, adminRegisterSeedingPlayer, adminRemoveSeedingPlayer } from "@/server/services/seedingAfk";

const steam = "76561198000000001";
const players = [{ steamId: steam, name: "A", faction: "A" }, { steamId: "76561198000000002", name: "B", faction: "A" }, { steamId: "76561198000000003", name: "C", faction: "B" }];
const live = () => ({ bootAt: 1000, map: "map", count: 3, players: structuredClone(players), factions: ["A", "B"], balanceLimit: 1 });
const input = { guildId: "guild", channelId: "12345678901234567", messageId: "12345678901234568", userId: "user", customId: "seeding-afk:register" };
function consent(id = "user", steamId = steam) {
  fake.registrations.push({ discord_id: id, steam_id: steamId, session_id: "session", registered_at: new Date(), next_switch_at: new Date(0), next_reminder_at: new Date(Date.now() + 60_000) });
}
beforeEach(() => {
  vi.clearAllMocks();
  fake.settings = seedingSettingsSchema.parse({ channelId: input.channelId, messageId: input.messageId });
  fake.runtime = { sessionId: "session", bootAt: 1000, map: "map", countBased: true, thresholdReached: false, terminated: false };
  fake.registrations = []; fake.logs = [];
  snapshot.mockResolvedValue(live()); move.mockResolvedValue(undefined); remind.mockResolvedValue(undefined);
  links.mockResolvedValue({ steamIds: new Map([["user", steam]]), source: { stale: false } });
});

describe("seeding safety decisions", () => {
  it("validates configurable defaults", () => {
    expect(seedingSettingsSchema.parse({})).toMatchObject({ enabled: true, threshold: 20, intervalSeconds: 120 });
    expect(seedingSettingsSchema.safeParse({ threshold: 0 }).success).toBe(false);
  });
  it("prefers the smallest other faction without blocking unbalanced moves", () => {
    expect(balancedDestination(players, ["A", "B"], steam)).toBe("B");
    expect(balancedDestination([...players, { steamId: "4", name: "D", faction: "B" }], ["A", "B"], steam)).toBe("B");
    expect(balancedDestination(players, ["A", "B", "C"], steam)).toBe("C");
    expect(balancedDestination(players, ["A", "B"], "unknown")).toBeNull();
  });
});
describe("consent and polling", () => {
  it("registers only the linked connected account and starts the interval on registration", async () => {
    expect(await seedingButton(input)).toContain("You are registered");
    expect(fake.registrations[0]).toMatchObject({ discord_id: "user", steam_id: steam, session_id: "session" });
    await seedingTick(); expect(move).not.toHaveBeenCalled();
    await seedingButton(input); expect(fake.registrations).toHaveLength(1);
  });
  it("refuses unlinked, disconnected, stale-link, wrong-guild and old-message registration", async () => {
    expect(await seedingButton({ ...input, guildId: "other" })).toContain("different server");
    expect(await seedingButton({ ...input, messageId: "old" })).toContain("no longer active");
    links.mockResolvedValueOnce({ steamIds: new Map(), source: { stale: false } });
    expect(await seedingButton(input)).toContain("Link your Discord");
    links.mockResolvedValueOnce({ steamIds: new Map([["user", steam]]), source: { stale: true } });
    expect(await seedingButton(input)).toContain("stale");
    snapshot.mockResolvedValue({ ...live(), players: [] });
    expect(await seedingButton(input)).toContain("Join the configured");
    expect(fake.registrations).toHaveLength(0);
  });
  it("moves only opted-in due players and prevents duplicate immediate moves", async () => {
    await seedingTick(); expect(move).not.toHaveBeenCalled();
    consent(); await seedingTick(); await seedingTick();
    expect(move).toHaveBeenCalledTimes(1); expect(move).toHaveBeenCalledWith(steam, "B");
    expect(fake.logs.every((entry) => typeof entry[0] === "string")).toBe(true);
  });
  it("withdraws only the caller's consent even when links are unavailable", async () => {
    consent(); consent("other", "76561198000000002"); links.mockRejectedValue(new Error("offline"));
    expect(await seedingButton({ ...input, customId: "seeding-afk:back" })).toContain("no longer registered");
    expect(fake.registrations.map((p) => p.discord_id)).toEqual(["other"]);
    fake.registrations = []; await seedingTick(); expect(move).not.toHaveBeenCalled();
  });
  it("removes disconnected players and keeps switching when teams are uneven", async () => {
    consent("gone", "76561198000000999"); await seedingTick(); expect(fake.registrations).toHaveLength(0);
    consent(); snapshot.mockResolvedValue({ ...live(), balanceLimit: 0 });
    await seedingTick(); expect(move).toHaveBeenCalledWith(steam, "B");
  });
  it("latches threshold shutdown even after population falls or settings are changed", async () => {
    consent(); snapshot.mockResolvedValueOnce({ ...live(), count: 20 });
    await seedingTick(); expect(fake.runtime.terminated).toBe(true); expect(fake.registrations).toHaveLength(0);
    await saveSeedingSettings(seedingSettingsSchema.parse({ ...fake.settings, threshold: 30 }), "admin");
    expect(await seedingButton(input)).toContain("Protection is stopped");
    expect(move).not.toHaveBeenCalled();
  });
  it("rechecks population before each action", async () => {
    consent(); snapshot.mockResolvedValueOnce(live()).mockResolvedValueOnce({ ...live(), count: 20 });
    await seedingTick(); expect(move).not.toHaveBeenCalled(); expect(fake.registrations).toHaveLength(0);
  });
  it("rechecks consent after slow safety reads", async () => {
    consent(); snapshot.mockResolvedValueOnce(live()).mockImplementationOnce(async () => { fake.registrations = []; return live(); });
    await seedingTick(); expect(move).not.toHaveBeenCalled();
  });
  it("fails closed on read outages, write failures, map changes and restarts", async () => {
    consent(); snapshot.mockRejectedValueOnce(new Error("offline")); await seedingTick();
    expect(fake.runtime.terminated).toBe(true); expect(fake.registrations).toHaveLength(0);
    fake.runtime.terminated = false; consent(); move.mockRejectedValueOnce(new Error("timeout"));
    await seedingTick(); expect(move).toHaveBeenCalledTimes(1); await seedingTick(); expect(move).toHaveBeenCalledTimes(1);
    fake.runtime.terminated = false; consent(); snapshot.mockResolvedValue({ ...live(), map: "new" }); await seedingTick();
    expect(fake.registrations).toHaveLength(0);
    fake.runtime.terminated = false; consent(); snapshot.mockResolvedValue({ ...live(), bootAt: 100000 }); await seedingTick();
    expect(fake.registrations).toHaveLength(0);
  });
  it("stops on disable", async () => {
    consent(); fake.settings.enabled = false; await seedingTick();
    expect(fake.registrations).toHaveLength(0); expect(move).not.toHaveBeenCalled();
  });
  it("starts from player count alone without a feed or token", async () => {
    fake.runtime = {};
    expect(await seedingButton(input)).toContain("You are registered");
    expect(fake.runtime.terminated).toBe(false);
    expect(fake.runtime.countBased).toBe(true);
  });
  it("recovers after an outage without restoring old registrations", async () => {
    consent(); snapshot.mockRejectedValueOnce(new Error("offline")); await seedingTick();
    await seedingTick(); expect(fake.runtime.terminated).toBe(false);
    expect(fake.registrations).toHaveLength(0); expect(move).not.toHaveBeenCalled();
    expect(await seedingButton(input)).toContain("You are registered");
  });
  it("starts a fresh session after map change while preserving threshold stops until then", async () => {
    snapshot.mockResolvedValueOnce({ ...live(), count: 20 }); await seedingTick();
    await seedingTick(); expect(await seedingButton(input)).toContain("Protection is stopped");
    snapshot.mockResolvedValue({ ...live(), map: "next" }); await seedingTick();
    expect(fake.runtime.terminated).toBe(false);
    expect(await seedingButton(input)).toContain("You are registered");
  });
});
describe("update preservation", () => {
  it("preserves registrations on dashboard worker startup", async () => {
    consent(); fake.registrations[0]!.next_switch_at = new Date(Date.now() + 120_000);
    const before = structuredClone(fake.registrations);
    const globals = globalThis as unknown as { __seedingTimer?: NodeJS.Timeout };
    try {
      startSeedingScheduler();
      await vi.waitFor(() => expect(snapshot).toHaveBeenCalled());
      expect(fake.registrations).toEqual(before);
    } finally {
      clearInterval(globals.__seedingTimer); delete globals.__seedingTimer;
    }
  });
  it("preserves registrations and cooldowns when settings are saved", async () => {
    consent(); const before = structuredClone(fake.registrations);
    await saveSeedingSettings(seedingSettingsSchema.parse({ ...fake.settings, title: "New title" }), "admin");
    expect(fake.registrations).toEqual(before);
  });
  it("preserves existing same-session registrations during a count-mode upgrade", async () => {
    consent(); fake.runtime.countBased = undefined;
    await seedingTick(); expect(fake.registrations).toHaveLength(1);
  });
});

describe("manual administration", () => {
  it("adds a linked connected player without changing other registrations or cooldowns", async () => {
    consent(); const before = structuredClone(fake.registrations[0]);
    links.mockResolvedValue({ steamIds: new Map([["user", steam], ["partner", "76561198000000003"]]), source: { stale: false } });
    await adminRegisterSeedingPlayer("76561198000000003", "admin");
    expect(fake.registrations).toHaveLength(2); expect(fake.registrations[0]).toEqual(before);
    expect(fake.logs.some((entry) => entry[0] === "admin" && entry[2] === "seeding_afk.admin_registered")).toBe(true);
    await adminRegisterSeedingPlayer("76561198000000003", "admin"); expect(fake.registrations).toHaveLength(2);
  });
  it("rejects unlinked, disconnected and disabled registrations", async () => {
    await expect(adminRegisterSeedingPlayer("76561198000000003", "admin")).rejects.toThrow("unique linked Discord");
    await expect(adminRegisterSeedingPlayer("76561198000000999", "admin")).rejects.toThrow("connected");
    fake.settings.enabled = false;
    await expect(adminRegisterSeedingPlayer(steam, "admin")).rejects.toThrow("disabled");
    expect(fake.registrations).toHaveLength(0);
  });
  it("rejects threshold registration and persists the session shutdown", async () => {
    consent(); snapshot.mockResolvedValue({ ...live(), count: 20 });
    await expect(adminRegisterSeedingPlayer(steam, "admin")).rejects.toThrow("threshold reached");
    expect(fake.runtime.thresholdReached).toBe(true); expect(fake.registrations).toHaveLength(0);
  });
  it("removes only the selected account and lets an admin-added player withdraw in Discord", async () => {
    consent("other", "76561198000000003");
    await adminRegisterSeedingPlayer(steam, "admin");
    await seedingButton({ ...input, customId: "seeding-afk:back" });
    expect(fake.registrations.map((p) => p.discord_id)).toEqual(["other"]);
    await adminRemoveSeedingPlayer("other", "admin"); expect(fake.registrations).toHaveLength(0);
  });
  it("keeps registrations when the game server rejects a move", async () => {
    consent(); move.mockRejectedValueOnce(new Error("Rejected by server"));
    await seedingTick(); expect(fake.registrations).toHaveLength(1);
    expect(fake.runtime.terminated).toBe(false);
  });
});

describe("private in-game reminders", () => {
  it("reminds after registration and every minute independently of team moves", async () => {
    await seedingButton(input);
    await seedingTick(); await seedingTick();
    expect(remind).toHaveBeenCalledTimes(1); expect(remind).toHaveBeenCalledWith(steam);
    expect(move).not.toHaveBeenCalled();
    fake.registrations[0]!.next_reminder_at = new Date(0);
    await seedingTick(); expect(remind).toHaveBeenCalledTimes(2);
  });
  it("stops reminders on Discord return, disconnect and threshold shutdown", async () => {
    await seedingButton(input); await seedingTick();
    await seedingButton({ ...input, customId: "seeding-afk:back" });
    await seedingTick(); expect(remind).toHaveBeenCalledTimes(1);
    consent(); fake.registrations[0]!.next_reminder_at = new Date(0);
    snapshot.mockResolvedValueOnce({ ...live(), count: 20 });
    await seedingTick(); expect(remind).toHaveBeenCalledTimes(1);
  });
  it("rechecks consent before whispering and does not disable protection on a whisper failure", async () => {
    consent(); fake.registrations[0]!.next_reminder_at = new Date(0);
    snapshot.mockResolvedValueOnce(live()).mockImplementationOnce(async () => { fake.registrations = []; return live(); });
    await seedingTick(); expect(remind).not.toHaveBeenCalled();
    consent(); fake.registrations[0]!.next_reminder_at = new Date(0);
    remind.mockRejectedValueOnce(new Error("message failed"));
    await seedingTick(); await seedingTick();
    expect(remind).toHaveBeenCalledTimes(1); expect(fake.runtime.terminated).toBe(false);
    expect(move).toHaveBeenCalledTimes(1);
  });
});
