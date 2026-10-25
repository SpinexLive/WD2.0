import { protectedRoute } from "@/lib/apiGuard";
import { getClanMembers } from "@/server/services/discord";
import { getLeagueApplications, getLeagueMembers, registrationStatus } from "@/server/services/wardogsLeague";
import type { Snapshot } from "@/lib/cache";
import { getPlayerStats } from "@/server/services/wardogsRcon";
import { resolveLinks } from "@/server/services/links";
import { kickMatchSync } from "@/server/services/matchHistory";

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
  const [clan, league, apps, links] = await Promise.all([getClanMembers(force), settle(getLeagueMembers(force)), settle(getLeagueApplications(force)), resolveLinks()]);

  // Stale league data is never treated as confirmed: statuses fall back to "unknown".
  const leagueMembers = league.snap && !league.snap.stale ? league.snap.data : null;
  const leagueApps = apps.snap && !apps.snap.stale ? apps.snap.data : null;

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
      registration: registrationStatus(m.id, leagueMembers, leagueApps),
      steamId: steamOf(m.id),
      kd: stats?.kd ?? null,
      kills: stats?.kills ?? null,
      deaths: stats?.deaths ?? null,
      matches: stats?.matches ?? null,
    };
  });

  const byId = new Map(clan.data.map((m) => [m.id, m]));
  const applications = (leagueApps ?? []).map((a) => {
    const d = a.discordId ? byId.get(a.discordId) : undefined;
    return { id: a.id, discordId: a.discordId, name: a.name, displayName: d?.displayName ?? a.name, avatarUrl: d?.avatarUrl ?? null };
  });

  // Only trustworthy when the League member list is fresh; otherwise null rather than guessing.
  const leagueOnly = leagueMembers
    ? leagueMembers.filter((l) => !byId.has(l.discordId)).map((l) => ({ discordId: l.discordId, name: l.name, role: l.role, joinedAt: l.joinedAt }))
    : null;

  return {
    members,
    leagueOnly,
    applications: leagueApps ? applications : null,
    summary: {
      total: members.length,
      registered: members.filter((m) => m.registration === "registered").length,
      unregistered: members.filter((m) => m.registration === "not_registered").length,
      unknown: members.filter((m) => m.registration === "unknown").length,
      pendingApplications: leagueApps ? applications.length : null,
    },
    sources: {
      discord: meta(clan),
      leagueMembers: meta(league.snap, league.error),
      leagueApplications: meta(apps.snap, apps.error),
      links: links.source,
      statsFailed,
      statsPending,
    },
  };
});
