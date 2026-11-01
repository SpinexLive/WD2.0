import { protectedRoute } from "@/lib/apiGuard";
import { query } from "@/lib/db";
import { ROSTER_TOKENS } from "@/lib/rosterTokens";

export const dynamic = "force-dynamic";

/** Staff: for each player, which roster tokens they are allowed to carry (strictly from their confirmed unlocks). */
export const GET = protectedRoute(async () => {
  const rows = await query<{ discord_id: string; item_key: string }>("SELECT discord_id, item_key FROM loadout_unlocks WHERE item_key = ANY($1::text[])", [ROSTER_TOKENS.map((t) => t.requires)]);
  const byItem = new Map(ROSTER_TOKENS.map((t) => [t.requires, t.key]));
  const eligible: Record<string, string[]> = {};
  for (const r of rows) (eligible[r.discord_id] ??= []).push(byItem.get(r.item_key)!);
  return { eligible };
});
