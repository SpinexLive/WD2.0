import { z } from "zod";
import type { PoolClient } from "pg";
import { query, tx } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { COMPETITIVE_PLAYER_CAP, type EventType, type PublishedMessage, type Roster, type RosterResponse, type RosterTemplate, type Squad } from "@/lib/rosterTypes";
import { publish } from "./bus";

const snowflake = z.string().regex(/^\d{15,22}$/);

export const slotSchema = z
  .object({
    discordId: snowflake,
    displayName: z.string().min(1).max(64),
    avatarUrl: z.string().max(300).regex(/^https:\/\/cdn\.discordapp\.com\//).nullable(),
    isLeader: z.boolean(),
  })
  .strict();

export const squadSchema = z
  .object({
    id: z.string().max(64),
    name: z.string().trim().min(1).max(40),
    category: z.string().trim().min(1).max(32),
    size: z.number().int().min(1).max(50),
    leaderRequired: z.boolean(),
    slots: z.array(slotSchema.nullable()).max(50),
  })
  .strict();

export const saveSchema = z
  .object({
    version: z.number().int().min(1),
    settings: z.object({ warnUnregistered: z.boolean() }),
    squads: z.array(squadSchema).min(1).max(40),
  })
  .strict();
export type SaveInput = z.infer<typeof saveSchema>;

export const eventIdSchema = z.string().regex(/^[\w-]{1,64}$/);

interface TemplateRow {
  id: number;
  key: string;
  name: string;
  event_type: EventType;
  definition: { squads: RosterTemplate["squads"] };
}

export async function listTemplates(): Promise<RosterTemplate[]> {
  const rows = await query<TemplateRow>("SELECT id, key, name, event_type, definition FROM roster_templates ORDER BY id");
  return rows.map((r) => ({ key: r.key, name: r.name, eventType: r.event_type, squads: r.definition.squads }));
}

interface RosterRow {
  id: string;
  raid_helper_event_id: string;
  event_type: EventType;
  template_key: string | null;
  settings: Roster["settings"];
  status: "draft" | "published";
  version: number;
  last_editor_id: string;
  updated_at: Date;
}

export async function getRoster(eventId: string): Promise<Roster | null> {
  const [r] = await query<RosterRow>(
    `SELECT r.*, t.key AS template_key FROM rosters r LEFT JOIN roster_templates t ON t.id = r.template_id WHERE r.raid_helper_event_id = $1`,
    [eventId],
  );
  if (!r) return null;
  const [squads, assignments, messages, responseRows] = await Promise.all([
    query<{ id: string; name: string; category: string; size: number; leader_required: boolean }>(
      "SELECT id, name, category, size, leader_required FROM roster_squads WHERE roster_id = $1 ORDER BY position",
      [r.id],
    ),
    query<{ squad_id: string; slot_index: number; discord_id: string; display_name: string; avatar_url: string | null; is_leader: boolean }>(
      "SELECT squad_id, slot_index, discord_id, display_name, avatar_url, is_leader FROM roster_assignments WHERE roster_id = $1",
      [r.id],
    ),
    query<{ part_index: number; channel_id: string; message_id: string; published_at: Date; updated_at: Date | null }>(
      "SELECT part_index, channel_id, message_id, published_at, updated_at FROM published_messages WHERE roster_id = $1 ORDER BY part_index",
      [r.id],
    ),
         query<{ discord_id: string; response: RosterResponse }>("SELECT discord_id, response FROM roster_responses WHERE roster_id = $1", [r.id]),
       ]);
       const assignedIds = new Set(assignments.map((a) => a.discord_id));
       const responses: Record<string, RosterResponse> = {};
       for (const x of responseRows) if (assignedIds.has(x.discord_id)) responses[x.discord_id] = x.response;

  const built: Squad[] = squads.map((s) => {
    const slots: Squad["slots"] = Array.from({ length: s.size }, () => null);
    for (const a of assignments) {
      if (a.squad_id === s.id && a.slot_index < s.size) {
        slots[a.slot_index] = { discordId: a.discord_id, displayName: a.display_name, avatarUrl: a.avatar_url, isLeader: a.is_leader };
      }
    }
    return { id: s.id, name: s.name, category: s.category, size: s.size, leaderRequired: s.leader_required, slots };
  });

  const pub: PublishedMessage[] = messages.map((m) => ({
    partIndex: m.part_index,
    channelId: m.channel_id,
    messageId: m.message_id,
    publishedAt: m.published_at.toISOString(),
    updatedAt: m.updated_at?.toISOString() ?? null,
  }));

  return {
    id: r.id,
    eventId: r.raid_helper_event_id,
    eventType: r.event_type,
    templateKey: r.template_key,
    settings: { warnUnregistered: r.settings?.warnUnregistered ?? true },
    status: r.status,
    version: r.version,
    lastEditorId: r.last_editor_id,
    updatedAt: r.updated_at.toISOString(),
    squads: built,
    messages: pub,
    responses,
  };
}

async function insertSquads(client: PoolClient, rosterId: string, squads: Squad[] | RosterTemplate["squads"]) {
  for (let i = 0; i < squads.length; i++) {
    const s = squads[i]!;
    const res = await client.query(
      `INSERT INTO roster_squads (roster_id, position, name, category, size, leader_required) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [rosterId, i, s.name, s.category, s.size, s.leaderRequired],
    );
    const squadId = res.rows[0]!.id;
    if ("slots" in s) {
      for (let j = 0; j < s.slots.length; j++) {
        const p = s.slots[j];
        if (!p) continue;
        await client.query(
          `INSERT INTO roster_assignments (roster_id, squad_id, slot_index, discord_id, display_name, avatar_url, is_leader) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [rosterId, squadId, j, p.discordId, p.displayName, p.avatarUrl, p.isLeader],
        );
      }
    }
  }
}

export async function createRoster(eventId: string, templateKey: string, editorId: string): Promise<Roster> {
  const [tpl] = await query<TemplateRow>("SELECT id, key, name, event_type, definition FROM roster_templates WHERE key = $1", [templateKey]);
  if (!tpl) throw new HttpError(400, "Unknown roster template", "bad_template");

  try {
    await tx(async (c) => {
      const res = await c.query(
        `INSERT INTO rosters (raid_helper_event_id, event_type, template_id, last_editor_id, created_by) VALUES ($1,$2,$3,$4,$4) RETURNING id`,
        [eventId, tpl.event_type, tpl.id, editorId],
      );
      await insertSquads(c, res.rows[0].id, tpl.definition.squads);
    });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new HttpError(409, "A roster already exists for this event", "exists");
    throw err;
  }
  publish("roster", { eventId });
  return (await getRoster(eventId))!;
}

/** Replaces squads and assignments if `version` is still current; otherwise reports a conflict instead of overwriting. */
export async function saveRoster(eventId: string, input: SaveInput, editorId: string): Promise<Roster> {
  const seen = new Set<string>();
  for (const s of input.squads) {
    if (s.slots.length !== s.size) throw new HttpError(400, `${s.name}: slots must match squad size`, "invalid_roster");
    if (s.slots.filter((p) => p?.isLeader).length > 1) throw new HttpError(400, `${s.name} has more than one leader`, "invalid_roster");
    for (const p of s.slots) {
      if (!p) continue;
      if (seen.has(p.discordId)) throw new HttpError(400, `${p.displayName} is assigned to more than one position`, "duplicate_assignment");
      seen.add(p.discordId);
    }
  }

  const [kind] = await query<{ event_type: EventType }>("SELECT event_type FROM rosters WHERE raid_helper_event_id = $1", [eventId]);
  if (!kind) throw new HttpError(404, "Roster not found", "not_found");
  const positions = input.squads.reduce((n, s) => n + s.size, 0);
  if (kind.event_type === "competitive" && positions > COMPETITIVE_PLAYER_CAP) {
    throw new HttpError(400, `Competitive rosters are limited to ${COMPETITIVE_PLAYER_CAP} players (this one has ${positions} positions).`, "roster_too_large");
  }

  await tx(async (c) => {
    const upd = await c.query(
      `UPDATE rosters SET settings = $3, version = version + 1, last_editor_id = $4, updated_at = now()
        WHERE raid_helper_event_id = $1 AND version = $2 RETURNING id`,
      [eventId, input.version, JSON.stringify(input.settings), editorId],
    );
    if (upd.rowCount === 0) {
      const cur = await c.query("SELECT version, last_editor_id, updated_at FROM rosters WHERE raid_helper_event_id = $1", [eventId]);
      if (cur.rowCount === 0) throw new HttpError(404, "Roster not found", "not_found");
      throw new HttpError(409, "This roster was changed by someone else. Reload to see their changes.", "conflict", {
        currentVersion: cur.rows[0].version,
        lastEditorId: cur.rows[0].last_editor_id,
      });
    }
    const rosterId = upd.rows[0].id as string;
    const before = await c.query<{ discord_id: string; name: string }>(
      "SELECT a.discord_id, s.name FROM roster_assignments a JOIN roster_squads s ON s.id = a.squad_id WHERE a.roster_id = $1",
      [rosterId],
    );
    await c.query("DELETE FROM roster_squads WHERE roster_id = $1", [rosterId]);
    await insertSquads(c, rosterId, input.squads);
    // A player who was removed or moved to a different squad has to confirm again.
    const now = new Map(input.squads.flatMap((s) => s.slots.flatMap((p) => (p ? [[p.discordId, s.name] as const] : []))));
    const stale = before.rows.filter((b) => now.get(b.discord_id) !== b.name).map((b) => b.discord_id);
    if (stale.length) await c.query("DELETE FROM roster_responses WHERE roster_id = $1 AND discord_id = ANY($2::text[])", [rosterId, stale]);
  });
  publish("roster", { eventId });
  return (await getRoster(eventId))!;
}

export async function deleteRoster(eventId: string, version: number): Promise<{ id: string }> {
  const del = await query<{ id: string }>(
    "DELETE FROM rosters WHERE raid_helper_event_id = $1 AND version = $2 RETURNING id",
    [eventId, version],
  );
  if (!del[0]) {
    if (!(await getRoster(eventId))) throw new HttpError(404, "Roster not found", "not_found");
    throw new HttpError(409, "This roster was changed by someone else. Reload to see their changes.", "conflict");
  }
  publish("roster", { eventId });
  return del[0];
}

export async function resetRoster(eventId: string, version: number, editorId: string): Promise<Roster> {
  const current = await getRoster(eventId);
  if (!current) throw new HttpError(404, "Roster not found", "not_found");
  const tpls = await listTemplates();
  const tpl = tpls.find((t) => t.key === current.templateKey) ?? tpls.find((t) => t.eventType === current.eventType);
  if (!tpl) throw new HttpError(500, "No template available for reset", "bad_template");

  await tx(async (c) => {
    const upd = await c.query(
      `UPDATE rosters SET version = version + 1, last_editor_id = $3, updated_at = now() WHERE raid_helper_event_id = $1 AND version = $2 RETURNING id`,
      [eventId, version, editorId],
    );
    if (upd.rowCount === 0) throw new HttpError(409, "This roster was changed by someone else. Reload to see their changes.", "conflict");
    await c.query("DELETE FROM roster_squads WHERE roster_id = $1", [upd.rows[0].id]);
    await c.query("DELETE FROM roster_responses WHERE roster_id = $1", [upd.rows[0].id]);
    await insertSquads(c, upd.rows[0].id, tpl.squads);
  });
  publish("roster", { eventId });
  return (await getRoster(eventId))!;
}
