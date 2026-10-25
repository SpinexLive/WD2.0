import { z } from "zod";
import { protectedRoute } from "@/lib/apiGuard";
import { requireOwner } from "@/lib/admin";
import { audit } from "@/lib/audit";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError, requestJson } from "@/lib/http";
import { getClanMembers } from "@/server/services/discord";
import { getPlayerStats } from "@/server/services/wardogsRcon";
import { resolveLinks } from "@/server/services/links";

export const dynamic = "force-dynamic";

async function whitelist(): Promise<string[]> {
  const { GAME_RCON_URL, GAME_RCON_PASSWORD } = env();
  if (!GAME_RCON_URL || !GAME_RCON_PASSWORD) throw new HttpError(503, "The game server RCON is not configured (GAME_RCON_URL / GAME_RCON_PASSWORD).", "not_configured");
  const { data } = await requestJson({ provider: "game-rcon", url: `${GAME_RCON_URL.replace(/\/+$/, "")}/v1/reserved-slots`, headers: { Authorization: `Bearer ${GAME_RCON_PASSWORD}` }, retries: 1, timeoutMs: 8000 });
  const list = (data as { reservedSlots?: unknown })?.reservedSlots;
  if (!Array.isArray(list)) throw new HttpError(502, "Unrecognised reserved-slots response from the game server.", "bad_response");
  return list.filter((s): s is string => typeof s === "string" && /^\d{17}$/.test(s));
}

/** The server whitelist (reserved slots) that is not linked to a Discord member, and the members still without a Steam ID. */
export const GET = protectedRoute(async ({ session }) => {
  requireOwner(session);
  const [slots, clan, manual, ignoredRows] = await Promise.all([
    whitelist(),
    getClanMembers(false),
    query<{ discord_id: string; steam_id: string; linked_at: Date }>("SELECT discord_id, steam_id, linked_at FROM member_links ORDER BY linked_at DESC"),
    query<{ steam_id: string }>("SELECT steam_id FROM ignored_steam_ids"),
  ]);
  const resolved = await resolveLinks();
  const activity = [...resolved.steamIds].filter(([d]) => !resolved.manual.has(d)).map(([d, s]) => ({ discord_id: d, steam_id: s }));
  const ignored = new Set(ignoredRows.map((r) => r.steam_id));

  const clanIds = new Set(clan.data.map((m) => m.id));
  const manualByDiscord = new Map(manual.map((l) => [l.discord_id, l.steam_id]));
  // A hand link replaces the API link for that member.
  const linkedSteam = new Set<string>(manual.map((l) => l.steam_id));
  const linkedMembers = new Set<string>(manualByDiscord.keys());
  const owner = new Map<string, { discordId: string; source: "manual" | "auto" }>(manual.map((l) => [l.steam_id, { discordId: l.discord_id, source: "manual" }]));
  for (const a of activity) {
    if (!clanIds.has(a.discord_id) || manualByDiscord.has(a.discord_id)) continue;
    linkedSteam.add(a.steam_id);
    linkedMembers.add(a.discord_id);
    if (!owner.has(a.steam_id)) owner.set(a.steam_id, { discordId: a.discord_id, source: "auto" });
  }

  const visible = slots.filter((s) => !ignored.has(s));
  const unlinked = visible.filter((s) => !linkedSteam.has(s));
  // In-game names come from the community stats; lookups that outlast 8s keep running and fill the cache for the next load.
  const names = new Map<string, string | null>();
  const lookups = Promise.all(visible.map(async (s) => {
    try {
      names.set(s, (await getPlayerStats(s)).data?.name ?? null);
    } catch {
      // name stays unknown
    }
  }));
  await Promise.race([lookups, new Promise((r) => setTimeout(r, 8000))]);

  const display = new Map(clan.data.map((m) => [m.id, m.displayName]));
  const sortedMembers = clan.data.map((m) => ({ id: m.id, displayName: m.displayName })).sort((a, b) => a.displayName.localeCompare(b.displayName));
  return {
    whitelistTotal: slots.length,
    ignoredCount: slots.filter((s) => ignored.has(s)).length,
    pending: visible.some((s) => !names.has(s)),
    unlinked: unlinked.map((s) => ({ steamId: s, name: names.get(s) ?? null })),
    linked: visible.flatMap((s) => {
      const o = owner.get(s);
      return o && display.has(o.discordId) ? [{ steamId: s, name: names.get(s) ?? null, discordId: o.discordId, member: display.get(o.discordId)!, source: o.source }] : [];
    }),
    members: sortedMembers.filter((m) => !linkedMembers.has(m.id)),
    allMembers: sortedMembers,
  };
});

const link = z.object({ steamId: z.string().regex(/^\d{17}$/), discordId: z.string().regex(/^\d{5,25}$/) });

export const POST = protectedRoute(async ({ req, session }) => {
  requireOwner(session);
  const { steamId, discordId } = link.parse(await req.json().catch(() => ({})));
  const clan = await getClanMembers(false);
  if (!clan.data.some((m) => m.id === discordId)) throw new HttpError(400, "That Discord user is not a clan member.", "not_member");
  if (!(await whitelist()).includes(steamId)) throw new HttpError(400, "That Steam ID is not on the server whitelist.", "not_whitelisted");
  await query("DELETE FROM member_links WHERE steam_id = $1 AND discord_id <> $2", [steamId, discordId]);
  await query(
    `INSERT INTO member_links (discord_id, steam_id, linked_by) VALUES ($1,$2,$3)
     ON CONFLICT (discord_id) DO UPDATE SET steam_id = EXCLUDED.steam_id, linked_by = EXCLUDED.linked_by, linked_at = now()`,
    [discordId, steamId, session.discordId],
  );
  await audit(session, "admin.link_steam", "member", discordId, { steamId });
  return { ok: true };
});

export const PUT = protectedRoute(async ({ session }) => {
  requireOwner(session);
  const rows = await query("DELETE FROM ignored_steam_ids RETURNING steam_id");
  await audit(session, "admin.unignore_all", "steam", null, { count: rows.length });
  return { restored: rows.length };
});

export const PATCH = protectedRoute(async ({ req, session }) => {
  requireOwner(session);
  const { steamId } = z.object({ steamId: z.string().regex(/^\d{17}$/) }).parse(await req.json().catch(() => ({})));
  await query("INSERT INTO ignored_steam_ids (steam_id, ignored_by) VALUES ($1,$2) ON CONFLICT (steam_id) DO NOTHING", [steamId, session.discordId]);
  await audit(session, "admin.ignore_steam", "steam", steamId);
  return { ok: true };
});

export const DELETE = protectedRoute(async ({ req, session }) => {
  requireOwner(session);
  const { discordId } = z.object({ discordId: z.string().regex(/^\d{5,25}$/) }).parse(await req.json().catch(() => ({})));
  await query("DELETE FROM member_links WHERE discord_id = $1", [discordId]);
  await audit(session, "admin.unlink_steam", "member", discordId);
  return { ok: true };
});
