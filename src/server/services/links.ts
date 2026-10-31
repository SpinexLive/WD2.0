import { query } from "@/lib/db";
import { getOfficialLinks } from "@/server/services/wardogsRcon";
import type { Snapshot } from "@/lib/cache";

/** Steam IDs an admin has linked by hand: Discord ID -> Steam ID. These override the official Wardogs links. */
export async function getManualLinks(): Promise<Map<string, string>> {
  const rows = await query<{ discord_id: string; steam_id: string }>("SELECT discord_id, steam_id FROM member_links");
  return new Map(rows.map((r) => [r.discord_id, r.steam_id]));
}

export interface ResolvedLinks {
  /** Discord ID -> Steam ID. */
  steamIds: Map<string, string>;
  /** The subset that came from a hand link. */
  manual: Map<string, string>;
  /** Metadata for the official links lookup, or the error if it failed. */
  source: { fetchedAt: string | null; stale: boolean; error: string | null; available: boolean };
}

/** Official Wardogs links (GET /links) with hand links taking precedence. There is no name matching. */
export async function resolveLinks(strictManual = false): Promise<ResolvedLinks> {
  const manual = await getManualLinks().catch((err: unknown) => {
    if (strictManual) throw err;
    return new Map<string, string>();
  });
  let snap: Snapshot<Map<string, string>> | null = null;
  let error: string | null = null;
  try {
    snap = await getOfficialLinks();
  } catch (err) {
    error = (err as Error).message;
  }
  const manualSteam = new Set(manual.values());
  const steamIds = new Map<string, string>();
  for (const [d, s] of snap?.data ?? []) if (!manual.has(d) && !manualSteam.has(s)) steamIds.set(d, s);
  for (const [d, s] of manual) steamIds.set(d, s);
  return {
    steamIds,
    manual,
    source: { fetchedAt: snap?.fetchedAt ?? null, stale: snap?.stale ?? false, error: snap?.error ?? error, available: snap !== null },
  };
}
