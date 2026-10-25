import { describe, expect, it, beforeAll } from "vitest";
import { buildRosterEmbeds, buildRosterMessages, embedSize, mentionContent, STATUS_ICON } from "@/server/embed";
import { movePlayer, resizeSquad, setLeader, findPlayer } from "@/lib/rosterOps";
import { validateRoster } from "@/lib/rosterValidation";
import { parseApplications, parseMembers, registrationStatus } from "@/server/services/wardogsLeague";
import { botCanPost, hasAuthorisedRole, hasMemberRole } from "@/server/services/discord";
import { parseEvent, parseSignups, formatTitle } from "@/server/services/raidHelper";
import { saveSchema } from "@/server/services/rosters";
import { upcomingEvents } from "@/server/services/landing";
import type { Squad } from "@/lib/rosterTypes";

beforeAll(() => {
  Object.assign(process.env, {
    DISCORD_CLIENT_ID: "1", DISCORD_CLIENT_SECRET: "s", DISCORD_BOT_TOKEN: "t", DISCORD_GUILD_ID: "1332320879073296404",
    DISCORD_ALLOWED_ROLE_IDS: "1349704360816414762,1546188874986950758", DISCORD_MEMBER_ROLE_ID: "1546184733174669424",
    RAID_HELPER_API_TOKEN: "r", WARDOGS_API_KEY: "w", TOURNAMENT_API_KEY: "k", DATABASE_URL: "postgres://x",
    SESSION_SECRET: "x".repeat(40), APP_URL: "http://localhost:3000",
  });
});

const id = (n: number) => String(100000000000000000n + BigInt(n));
const squad = (sid: string, size: number, over: Partial<Squad> = {}): Squad => ({ id: sid, name: sid, category: "INFANTRY", size, leaderRequired: true, slots: Array.from({ length: size }, () => null), ...over });
const ref = (n: number) => ({ discordId: id(n), displayName: `P${n}`, avatarUrl: null });

describe("access roles", () => {
  it("grants access for either authorised role and denies otherwise", () => {
    expect(hasAuthorisedRole(["1349704360816414762"])).toBe(true);
    expect(hasAuthorisedRole(["1546188874986950758"])).toBe(true);
    expect(hasAuthorisedRole(["1546184733174669424"])).toBe(false);
    expect(hasAuthorisedRole([])).toBe(false);
    expect(hasMemberRole(["1546184733174669424"])).toBe(true);
    expect(hasMemberRole(["1349704360816414762"])).toBe(false);
  });
});

describe("bot channel permissions", () => {
  const guildId = "1";
  const base = { guildId, botId: "9", botRoleIds: ["5"] };
  const need = (1n << 10n) | (1n << 11n) | (1n << 14n);
  it("allows via role permissions and blocks via overwrites", () => {
    const rolePerms = new Map([["1", 0n], ["5", need]]);
    expect(botCanPost({ ...base, rolePerms, overwrites: [] })).toBe(true);
    expect(botCanPost({ ...base, rolePerms, overwrites: [{ id: "5", type: 0, allow: "0", deny: String(1n << 11n) }] })).toBe(false);
    expect(botCanPost({ ...base, rolePerms, overwrites: [{ id: "5", type: 0, allow: "0", deny: String(1n << 11n) }, { id: "9", type: 1, allow: String(1n << 11n), deny: "0" }] })).toBe(true);
  });
  it("administrator bypasses overwrites", () => {
    expect(botCanPost({ ...base, rolePerms: new Map([["5", 1n << 3n]]), overwrites: [{ id: "1", type: 0, allow: "0", deny: String(need) }] })).toBe(true);
  });
});

describe("Wardogs League matching", () => {
  it("matches by Discord ID only and reports unknown when data is unavailable", () => {
    const members = [{ discordId: id(1), name: "A", role: null, joinedAt: null }];
    const apps = [{ id: "1", discordId: id(2), name: "B", role: null, joinedAt: null }];
    expect(registrationStatus(id(1), members, apps)).toBe("registered");
    expect(registrationStatus(id(2), members, apps)).toBe("pending");
    expect(registrationStatus(id(3), members, apps)).toBe("not_registered");
    expect(registrationStatus(id(3), null, apps)).toBe("unknown");
    expect(registrationStatus(id(3), members, null)).toBe("unknown");
    expect(registrationStatus(id(3), members, [{ id: "2", discordId: null, name: "x" }])).toBe("unknown");
  });
  it("rejects numeric Discord IDs and unrecognised shapes", () => {
    expect(() => parseMembers({ members: [{ discordId: 123456789012345678 }] })).toThrow();
    expect(() => parseMembers({ nope: 1 })).toThrow();
    expect(parseMembers({ members: [{ discord_id: id(1), name: "A" }] })[0]?.discordId).toBe(id(1));
    expect(parseApplications([{ id: 4, discordId: id(1), status: "accepted" }, { id: 5, discordId: id(2) }]).map((a) => a.id)).toEqual(["5"]);
  });
});

describe("Raid Helper parsing", () => {
  it("expands {eventtime#...} placeholders in titles", () => {
    const ts = Date.UTC(2026, 9, 27, 12, 0, 0) / 1000;
    expect(formatTitle("Scrim {eventtime#EEEE, dd. MMMM}", ts)).toBe("Scrim Tuesday, 27. October");
    expect(formatTitle("No placeholder", ts)).toBe("No placeholder");
    expect(formatTitle("{eventtime#EEEE}", null)).toBe("{eventtime#EEEE}");
  });
  it("parses events and sign-ups defensively", () => {
    const e = parseEvent({ id: "123", title: "Scrim", startTime: 1900000000, channelId: id(7), signUpCount: 3 });
    expect(e).toMatchObject({ id: "123", title: "Scrim", signupCount: 3, startTime: 1900000000 });
    expect(e?.discordUrl).toContain("/channels/1332320879073296404/");
    expect(parseEvent({ title: "no id" })).toBeNull();
    const s = parseSignups([{ userId: id(1), name: "A", className: "Absence" }, { userId: 5, name: "bad" }]);
    expect(s).toHaveLength(1);
    expect(s[0]?.absent).toBe(true);
  });
});

describe("roster operations", () => {
  it("never lets a player occupy two slots", () => {
    let s = [squad("a", 2), squad("b", 2)];
    s = movePlayer(s, ref(1), { kind: "slot", squadId: "a", index: 0 });
    s = movePlayer(s, ref(1), { kind: "slot", squadId: "b", index: 1 });
    expect(s.flatMap((x) => x.slots).filter(Boolean)).toHaveLength(1);
    expect(findPlayer(s, id(1))).toEqual({ squadId: "b", index: 1 });
  });
  it("swaps between slots and returns displaced pool occupants to Unassigned", () => {
    let s = [squad("a", 2)];
    s = movePlayer(s, ref(1), { kind: "slot", squadId: "a", index: 0 });
    s = movePlayer(s, ref(2), { kind: "slot", squadId: "a", index: 1 });
    s = movePlayer(s, ref(1), { kind: "slot", squadId: "a", index: 1 });
    expect(s[0]!.slots.map((p) => p?.discordId)).toEqual([id(2), id(1)]);
    s = movePlayer(s, ref(3), { kind: "slot", squadId: "a", index: 0 });
    expect(findPlayer(s, id(2))).toBeNull();
    s = movePlayer(s, ref(3), { kind: "pool" });
    expect(findPlayer(s, id(3))).toBeNull();
  });
  it("drops onto a squad take its first empty slot and refuse a full squad", () => {
    let s = [squad("a", 2), squad("b", 1)];
    s = movePlayer(s, ref(1), { kind: "squad", squadId: "a" });
    s = movePlayer(s, ref(2), { kind: "squad", squadId: "a" });
    expect(s[0]!.slots.map((p) => p?.discordId)).toEqual([id(1), id(2)]);
    expect(movePlayer(s, ref(3), { kind: "squad", squadId: "a" })).toBe(s);
    s = movePlayer(s, ref(1), { kind: "squad", squadId: "b" });
    expect(findPlayer(s, id(1))).toEqual({ squadId: "b", index: 0 });
  });
  it("keeps a single leader and drops players on shrink", () => {
    let s = [squad("a", 3)];
    s = movePlayer(movePlayer(s, ref(1), { kind: "slot", squadId: "a", index: 0 }), ref(2), { kind: "slot", squadId: "a", index: 2 });
    s = setLeader(s, "a", id(1));
    s = setLeader(s, "a", id(2));
    expect(s[0]!.slots.filter((p) => p?.isLeader).map((p) => p!.discordId)).toEqual([id(2)]);
    expect(resizeSquad(s[0]!, 2).slots).toHaveLength(2);
  });
});

describe("roster validation", () => {
  const settings = { warnUnregistered: true };
  it("flags missing leader, empty, unregistered and removed sign-ups", () => {
    let s = [squad("a", 2)];
    s = movePlayer(s, ref(1), { kind: "slot", squadId: "a", index: 0 });
    const signups = [{ discordId: id(1), name: "P1", role: null, status: null, absent: false, registration: "not_registered" as const, avatarUrl: null, kd: null, deaths: null }];
    const types = validateRoster({ squads: s, settings, eventType: "competitive" }, signups).map((w) => w.type);
    expect(types).toEqual(expect.arrayContaining(["empty_position", "missing_leader", "unregistered"]));
    const gone = validateRoster({ squads: s, settings, eventType: "competitive" }, []).map((w) => w.type);
    expect(gone).toContain("not_signed_up");
  });
  it("makes registration warnings configurable and skips sign-up checks without Raid Helper data", () => {
    const s = movePlayer([squad("a", 1, { leaderRequired: false })], ref(1), { kind: "slot", squadId: "a", index: 0 });
    const signups = [{ discordId: id(1), name: "P1", role: null, status: null, absent: false, registration: "not_registered" as const, avatarUrl: null, kd: null, deaths: null }];
    expect(validateRoster({ squads: s, settings: { ...settings, warnUnregistered: false }, eventType: "weekly" }, signups)).toHaveLength(0);
    expect(validateRoster({ squads: s, settings, eventType: "weekly" }, null)).toHaveLength(0);
  });
  it("reports duplicate assignments as errors", () => {
    const p = { discordId: id(1), displayName: "P1", avatarUrl: null, isLeader: false };
    const s = [squad("a", 1, { slots: [p] }), squad("b", 1, { slots: [p] })];
    expect(validateRoster({ squads: s, settings, eventType: "weekly" }, null).some((w) => w.type === "duplicate" && w.severity === "error")).toBe(true);
  });
});

describe("save input validation", () => {
  const base = { version: 1, settings: { warnUnregistered: true }, squads: [{ id: "x", name: "S", category: "INFANTRY", size: 1, leaderRequired: false, slots: [null] }] };
  it("accepts incomplete rosters and rejects bad IDs / avatar hosts", () => {
    expect(saveSchema.safeParse(base).success).toBe(true);
    const bad = structuredClone(base) as unknown as { squads: { slots: unknown[] }[] };
    bad.squads[0]!.slots = [{ discordId: "abc", displayName: "x", avatarUrl: null, isLeader: false }];
    expect(saveSchema.safeParse(bad).success).toBe(false);
    bad.squads[0]!.slots = [{ discordId: id(1), displayName: "x", avatarUrl: "https://evil.example/a.png", isLeader: false }];
    expect(saveSchema.safeParse(bad).success).toBe(false);
  });
});

describe("Discord embeds", () => {
  const fill = (n: number, size: number) =>
    Array.from({ length: n }, (_, i) => squad(`Squad ${i + 1}`, size, { slots: Array.from({ length: size }, (_, j) => ({ discordId: id(i * 100 + j), displayName: `Player_${i}_${j} *x*`, avatarUrl: null, isLeader: j === 0 })) }));
  const input = (squads: Squad[]) => ({ eventTitle: "REMNANT vs Opp", startTime: 1900000000, eventType: "competitive" as const, eventUrl: "https://discord.com/channels/1/2/3", squads });

  it("renders a small roster as one embed with event details", () => {
    const e = buildRosterEmbeds({ ...input([squad("Commander", 1, { category: "COMMAND", slots: [{ discordId: id(1), displayName: "Boss", avatarUrl: null, isLeader: false }] })]), eventDescription: "Bring mics." });
    expect(e).toHaveLength(1);
    expect(e[0]!.title).toBe("REMNANT vs Opp");
    expect(e[0]!.description).toMatch(/^Bring mics\./);
    expect(e[0]!.description).toContain("Date:");
    expect(e[0]!.description).toContain("**Time:** <t:1900000000:t>");
    expect(e[0]!.fields[0]).toMatchObject({ name: "COMMAND • Commander", value: `${STATUS_ICON.pending} <@${id(1)}>` });
  });
  it("splits very large rosters while respecting Discord limits", () => {
    const embeds = buildRosterEmbeds(input(fill(40, 30)));
    expect(embeds.length).toBeGreaterThan(1);
    for (const e of embeds) {
      expect(e.fields.length).toBeLessThanOrEqual(25);
      expect(embedSize(e)).toBeLessThanOrEqual(6000);
      for (const f of e.fields) {
        expect(f.value.length).toBeLessThanOrEqual(1024);
        expect(f.name.length).toBeLessThanOrEqual(256);
      }
    }
    expect(embeds.at(-1)!.footer?.text).toContain(`Part ${embeds.length}/${embeds.length}`);
  });
  it("splits an oversized single squad into continuation fields", () => {
    const embeds = buildRosterEmbeds(input(fill(1, 50)));
    const fields = embeds.flatMap((e) => e.fields);
    expect(fields.length).toBeGreaterThan(1);
    expect(fields.every((f) => f.value.length <= 1024)).toBe(true);
  });
  it("always mentions every assigned player and shows their confirmation status", () => {
    const sq = squad("S", 2, { slots: [{ discordId: id(1), displayName: "@everyone *hi*", avatarUrl: null, isLeader: false }, { discordId: id(2), displayName: "B", avatarUrl: null, isLeader: false }] });
    const [m] = buildRosterMessages({ ...input([sq]), responses: { [id(1)]: "accepted", [id(2)]: "declined" } });
    expect(m!.mentions).toEqual([id(1), id(2)]);
    expect(m!.embed.fields[0]!.value).toContain(`${STATUS_ICON.accepted} <@${id(1)}>`);
    expect(m!.embed.fields[0]!.value).toContain(`${STATUS_ICON.declined} <@${id(2)}>`);
    expect(m!.embed.fields[0]!.value).not.toContain("@everyone");
    expect(m!.embed.footer?.text).toBe("1 confirmed | 0 pending | 1 declined | ★ = Squad Leader");
    expect(mentionContent(m!.mentions, true)).toBe(`Roster posted for confirmation: <@${id(1)}> <@${id(2)}>`);
    expect(mentionContent([], true)).toBeUndefined();
  });
});

describe("landing page events", () => {
  const ev = (id: string, startTime: number | null) => ({ id, title: id, startTime, signupCount: 3, status: "upcoming" as const, channelId: null, discordUrl: null, description: null });
  it("keeps upcoming events, nearest first, and drops old ones", () => {
    const now = Date.UTC(2026, 9, 25, 12) ;
    const s = now / 1000;
    const out = upcomingEvents([ev("late", s + 7200), ev("old", s - 5 * 3600), ev("none", null), ev("soon", s + 600), ev("live", s - 1800)], now);
    expect(out.map((e) => e.id)).toEqual(["live", "soon", "late"]);
  });
});
