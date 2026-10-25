"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/client";
import { ErrorBanner, Skeleton, SyncInfo } from "@/components/ui";
import type { LeaderboardRange, LeaderboardRow, LeaderboardSort } from "@/server/services/wardogsRcon";

interface Board { range: LeaderboardRange; sort: LeaderboardSort; rows: LeaderboardRow[]; fetchedAt: string; stale: boolean; mySteamId: string | null }

const RANGES: { key: LeaderboardRange; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "all", label: "All time" },
];
const SORTS: { key: LeaderboardSort; label: string }[] = [
  { key: "kills", label: "Kills" },
  { key: "kd", label: "K/D" },
  { key: "cash", label: "Cash" },
  { key: "matches", label: "Matches" },
];

const kdColor = (kd: number) => (kd >= 2 ? "#6FB584" : kd >= 1 ? "#E8E6E1" : "#C4495A");

export default function LeaderboardClient() {
  const api = useApi();
  const [range, setRange] = useState<LeaderboardRange>("30d");
  const [sort, setSort] = useState<LeaderboardSort>("kills");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      setError(null);
      try {
        setData(await api<Board>(`/api/leaderboard?range=${range}&sort=${sort}${refresh ? "&refresh=1" : ""}`));
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [api, range, sort],
  );
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  const q = search.trim().toLowerCase();
  const rows = (data?.rows ?? []).filter((r) => !q || (r.name ?? "").toLowerCase().includes(q));
  const mine = data?.rows.find((r) => r.steamId === data.mySteamId) ?? null;
  const chip = (on: boolean) => `rounded border px-3 py-1 text-sm ${on ? "border-blood-400 bg-blood-700/30" : "border-ink-600 text-stone/70 hover:border-ink-500"}`;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Leaderboard</h1>
        <div className="flex items-center gap-3">
          {data && <SyncInfo label="Updated" fetchedAt={data.fetchedAt} stale={data.stale} />}
          <button className="btn-ghost" onClick={() => void load(true)}>Refresh</button>
        </div>
      </div>
      <p className="text-sm text-stone/60">Top 100 on the Wardogs game server. {sort === "kd" ? "K/D only lists players with at least 5 matches. " : ""}Your row is highlighted if your Steam account is linked.</p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex gap-1" role="group" aria-label="Time range">{RANGES.map((r) => <button key={r.key} className={chip(range === r.key)} onClick={() => setRange(r.key)}>{r.label}</button>)}</div>
        <div className="flex gap-1" role="group" aria-label="Sort by">{SORTS.map((s) => <button key={s.key} className={chip(sort === s.key)} onClick={() => setSort(s.key)}>{s.label}</button>)}</div>
        <input className="input !w-48" placeholder="Search player" aria-label="Search player" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {data && data.mySteamId && !mine && <p className="text-xs text-stone/55">You aren&apos;t in the top 100 for this view.</p>}
      {!data && !error && <div className="space-y-1.5">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>}
      {data && rows.length === 0 && <p className="text-sm text-stone/55">No players found.</p>}

      {rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[560px] text-left">
            <thead><tr><th className="th w-12">#</th><th className="th">Player</th><th className="th">Kills</th><th className="th">Deaths</th><th className="th">K/D</th><th className="th">Matches</th><th className="th">Cash</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const me = r.steamId === data?.mySteamId;
                return (
                  <tr key={r.steamId} className={`border-t border-ink-800 ${me ? "bg-blood-700/20" : "hover:bg-ink-800/50"}`}>
                    <td className={`px-3 py-1.5 text-sm font-bold tabular-nums ${r.rank <= 3 ? "text-blood-300" : "text-stone/60"}`}>{r.rank}</td>
                    <td className="px-3 py-1.5 text-sm font-semibold">{r.name ?? "Unknown"}{me && <span className="ml-2 rounded bg-blood-600/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">You</span>}</td>
                    <td className="px-3 py-1.5 text-sm tabular-nums">{r.kills.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-sm tabular-nums">{r.deaths.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-sm font-semibold tabular-nums" style={{ color: kdColor(r.kd) }}>{r.kd.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-sm tabular-nums">{r.matches}</td>
                    <td className="px-3 py-1.5 text-sm tabular-nums">{r.cash === null ? "-" : r.cash.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
