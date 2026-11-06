"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/client";
import { ErrorBanner, Skeleton, WarnBanner } from "@/components/ui";
import { WdlParticipants } from "@/components/WdlParticipants";
import type { WdlFixture } from "@/lib/wdlFixtures";
import type { WdlFixtureOverview } from "@/server/services/wdlFixtures";

const date = (value: string | null) => value
  ? new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
  : "Time TBC";

function Fixture({ fixture, result, eventId, eventState }: { fixture: WdlFixture; result: boolean; eventId?: string | null; eventState?: string }) {
  const competition = fixture.competition;
  return (
    <article className="space-y-1 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{fixture.participants.map((p) => p.team.code || p.team.name || "Team TBC").join(" v ") || "Teams TBC"}</strong>
        <span className="text-xs text-stone/60">{date(fixture.scheduledAt)}</span>
      </div>
      <div className="text-xs text-stone/60">
        {[fixture.number !== null ? `#${fixture.number}` : null, fixture.status, competition?.competition || "Competition TBC", competition?.season, competition?.division, competition?.round != null ? `Round ${competition.round}` : null, fixture.map || "Map TBC", fixture.gameMode || "Mode TBC"]
          .filter(Boolean).join(" · ") || "Fixture details TBC"}
      </div>
      <WdlParticipants participants={fixture.participants} result={result} />
      {eventId && <Link href={`/rosters/${encodeURIComponent(eventId)}`} className="text-xs text-blood-300 hover:underline">Open roster →</Link>}
      {eventState && ["review", "uncertain", "waiting"].includes(eventState) && <p className="text-xs text-warn">Raid Helper event needs staff review.</p>}
    </article>
  );
}

export default function FixturesPanel() {
  const api = useApi();
  const [data, setData] = useState<WdlFixtureOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [opponent, setOpponent] = useState("");
  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      setData(await api<WdlFixtureOverview>(`/api/wdl/fixtures${refresh ? "?refresh=1" : ""}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  const opponents = useMemo(() => [...new Set((data?.recent ?? []).flatMap((f) =>
    f.participants.flatMap((p) => p.team.code && p.team.code.toUpperCase() !== "RMNT" ? [p.team.code] : []),
  ))].sort(), [data]);
  const results = useMemo(() => (data?.recent ?? []).filter((fixture) =>
    !opponent || fixture.participants.some((p) => p.team.code === opponent),
  ), [data, opponent]);
  const upcoming = useMemo(() => data?.upcoming ? [...data.upcoming].sort((a, b) =>
    (a.scheduledAt ? Date.parse(a.scheduledAt) : Infinity) - (b.scheduledAt ? Date.parse(b.scheduledAt) : Infinity),
  ) : null, [data]);

  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">League fixtures</h2>
        <button className="btn-ghost" disabled={loading} onClick={() => void load(true)}>Refresh fixtures</button>
      </div>
      {error && <ErrorBanner message={error} onRetry={() => void load(true)} />}
      {data && (!data.source.available || data.source.stale) && <WarnBanner>Wardogs League is unavailable; fixture data may be outdated. {data.source.error}</WarnBanner>}
      {loading && !data && <Skeleton className="h-24" />}
      {data && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded border border-ink-700">
            <h3 className="border-b border-ink-700 px-4 py-2 text-sm font-semibold">Upcoming</h3>
            {upcoming === null ? <p className="p-4 text-sm text-stone/60">Upcoming fixtures are unavailable.</p>
              : upcoming.length ? <div className="max-h-96 divide-y divide-ink-700 overflow-y-auto">{upcoming.map((fixture) => <Fixture key={fixture.id} fixture={fixture} result={false} eventId={data.links[fixture.id]?.eventId} eventState={data.links[fixture.id]?.state} />)}</div>
                : <p className="p-4 text-sm text-stone/60">No upcoming fixtures returned by WDL.</p>}
          </div>
          <div className="rounded border border-ink-700">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 px-4 py-2">
              <h3 className="text-sm font-semibold">Recent results and opponent history</h3>
              <select aria-label="Filter results by opponent" className="input !w-auto !py-1" value={opponent} onChange={(e) => setOpponent(e.target.value)}>
                <option value="">All opponents</option>
                {opponents.map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
            </div>
            {opponent && <p className="px-4 pt-2 text-xs"><Link href={`/scouting?team=${encodeURIComponent(opponent)}`} className="text-blood-300 hover:underline">Search scouting for {opponent}</Link></p>}
            {results.length ? <div className="max-h-96 divide-y divide-ink-700 overflow-y-auto">{results.map((fixture) => <Fixture key={fixture.id} fixture={fixture} result />)}</div>
              : <p className="p-4 text-sm text-stone/60">No available results for this selection.</p>}
            <p className="px-4 pb-3 text-xs text-stone/50">Results include WDL’s recent response and records archived by this dashboard; older history may be incomplete.</p>
          </div>
        </div>
      )}
    </section>
  );
}
