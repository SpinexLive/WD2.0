import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ query: vi.fn(), tx: vi.fn(), publish: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mocks.query, tx: mocks.tx }));
vi.mock("@/server/services/bus", () => ({ publish: mocks.publish }));
vi.mock("@/lib/apiGuard", () => ({ protectedRoute: (handler: () => Promise<unknown>) => handler }));

import { GET as getEligibility } from "@/app/api/loadout/eligibility/route";
import { saveRoster, saveSchema } from "@/server/services/rosters";

const playerId = "111111111111111111";
const input = saveSchema.parse({
  version: 1,
  settings: { warnUnregistered: true },
  squads: [{
    id: "s1", name: "Infantry", category: "INFANTRY", size: 1, leaderRequired: false,
    slots: [{ discordId: playerId, displayName: "Alpha", avatarUrl: null, isLeader: false, tokens: ["maaws"] }],
  }],
});

describe("MAAWs roster eligibility", () => {
  beforeEach(() => vi.resetAllMocks());

  it("reports eligibility only for players with the MAAWs unlock", async () => {
    mocks.query.mockResolvedValue([
      { discord_id: playerId, item_key: "MAAWs" },
      { discord_id: "222222222222222222", item_key: "Defibrillator" },
    ]);

    const result = await getEligibility(new NextRequest("https://example.test/api/loadout/eligibility"), { params: Promise.resolve({}) });
    expect(result).toEqual({ eligible: { [playerId]: ["maaws"], "222222222222222222": ["defib"] } });
    expect(mocks.query.mock.calls[0]![1][0]).toContain("MAAWs");
  });

  it("rejects a MAAWs assignment if the player has not confirmed that unlock", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT event_type")) return [{ event_type: "weekly" }];
      if (sql.includes("FROM loadout_unlocks")) return [{ discord_id: playerId, item_key: "Defibrillator" }];
      if (sql.includes("FROM roster_assignments")) return [];
      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(saveRoster("event1", input, "editor")).rejects.toMatchObject({
      status: 400,
      code: "token_not_unlocked",
      message: expect.stringContaining("MAAWs"),
    });
    expect(mocks.tx).not.toHaveBeenCalled();
  });

  it("saves MAAWs for a player who confirmed it and returns it on the roster", async () => {
    let savedTokens: string[] = [];
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT event_type")) return [{ event_type: "weekly" }];
      if (sql.includes("FROM loadout_unlocks")) return [{ discord_id: playerId, item_key: "MAAWs" }];
      if (sql.includes("SELECT a.discord_id, a.tokens")) return [];
      if (sql.includes("SELECT r.*, t.key")) return [{
        id: "1", raid_helper_event_id: "event1", event_type: "weekly", template_key: null,
        settings: input.settings, status: "draft", version: 2, last_editor_id: "editor", updated_at: new Date("2026-01-01"),
      }];
      if (sql.includes("FROM roster_squads WHERE")) return [{ id: "s1", name: "Infantry", category: "INFANTRY", size: 1, leader_required: false }];
      if (sql.includes("FROM roster_assignments WHERE")) return [{
        squad_id: "s1", slot_index: 0, discord_id: playerId, mercenary_id: null,
        display_name: "Alpha", avatar_url: null, is_leader: false, tokens: savedTokens,
      }];
      if (sql.includes("FROM published_messages") || sql.includes("FROM roster_responses")) return [];
      throw new Error(`Unexpected query: ${sql}`);
    });
    mocks.tx.mockImplementation(async (run: (client: { query: (sql: string, values?: unknown[]) => Promise<unknown> }) => Promise<unknown>) => {
      const query = vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("UPDATE rosters")) return { rowCount: 1, rows: [{ id: "1" }] };
        if (sql.includes("INSERT INTO roster_squads")) return { rows: [{ id: "s1" }] };
        if (sql.includes("INSERT INTO roster_assignments")) {
          const tokens = values?.[8];
          if (!Array.isArray(tokens) || !tokens.every((token: unknown) => typeof token === "string")) throw new Error("Missing saved tokens");
          savedTokens = tokens;
        }
        return { rows: [] };
      });
      return run({ query });
    });

    const roster = await saveRoster("event1", input, "editor");
    expect(savedTokens).toEqual(["maaws"]);
    expect(roster.squads[0]!.slots[0]!.tokens).toEqual(["maaws"]);
  });
});
