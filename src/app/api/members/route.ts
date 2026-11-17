import { protectedRoute } from "@/lib/apiGuard";
import { getClanMembers } from "@/server/services/discord";
import type { Snapshot } from "@/lib/cache";
import { getPlayerStats } from "@/server/services/wardogsRcon";
import { resolveLinks } from "@/server/services/links";
import { kickMatchSync } from "@/server/services/matchHistory";
import { getGwlMembers } from "@/server/services/gwl";
import { gwlMemberMatcher } from "@/lib/gwlMemberStatus";

export const dynamic = "force-dynamic";

const meta = (s: Snapshot<unknown> | null, error?: string) => ({
  fetchedAt: s?.fetchedAt ?? null,
  stale: s?.stale ?? false,
  error: s?.error ?? error ?? null,
  available: s !== null,
});

async function settle<T>(p: Promise<Snapshot<T>>): Promise<{ snap: Snapshot<T> | null; error?: string }> {
  try {
    return { snap: await p };
  } catch (err) {
    return { snap: null, error: (err as Error).message };
  }
}

export const GET = protectedRoute(async ({ req }) => {
  const force = req.nextUrl.searchParams.get("refresh") === "1";
  kickMatchSync(force);
  const [clan, links, gwl] = await Promise.all([getClanMembers(force), resolveLinks(), settle(getGwlMembers(force))]);
  const gwlMatcher = gwlMemberMatcher(gwl.snap);

  const steamOf = (id: string) => links.steamIds.get(id) ?? null;

  // K/D is looked up per Steam ID. Lookups that outlast 8s keep running and fill the cache for the next load; a failure leaves K/D empty.
  const statsByDiscord = new Map<string, { kd: number | null; kills: number; deaths: number; matches: number } | null>();
  let statsFailed = 0;
  const linkedMembers = clan.data.filter((m) => steamOf(m.id));
  const lookups = Promise.all(
    linkedMembers.map(async (m) => {
      try {
        const s = await getPlayerStats(steamOf(m.id)!, force);
        statsByDiscord.set(m.id, s.stale ? null : s.data);
      } catch {
        statsFailed++;
      }
    }),
  );
  await Promise.race([lookups, new Promise((r) => setTimeout(r, 8000))]);
  const statsPending = statsByDiscord.size + statsFailed < linkedMembers.length;

  const members = clan.data.map((m) => {
    const stats = statsByDiscord.get(m.id);
    return {
      id: m.id,
      displayName: m.displayName,
      avatarUrl: m.avatarUrl,
      gwlStatus: gwlMatcher.status(m.id),
      steamId: steamOf(m.id),
      kd: stats?.kd ?? null,
      kills: stats?.kills ?? null,
      deaths: stats?.deaths ?? null,
      matches: stats?.matches ?? null,
    };
  });

  return {
    members,
    summary: {
      total: members.length,
      gwlLinked: members.filter((m) => m.gwlStatus === "linked").length,
      gwlUnmatched: members.filter((m) => m.gwlStatus === "not_matched").length,
      gwlUnknown: members.filter((m) => m.gwlStatus === "unknown").length,
    },
    sources: {
      discord: meta(clan),
      gwlMembers: { ...meta(gwl.snap, gwl.error), missingScope: gwlMatcher.missingScope },
      links: links.source,
      statsFailed,
      statsPending,
    },
  };
}, { membersViewerOnly: true });
