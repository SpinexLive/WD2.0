"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/client";
import { ErrorBanner, Skeleton } from "@/components/ui";
import type { AttendanceReport } from "@/server/services/attendance";

type Range = "30d" | "90d" | "all";
const RANGES: { key: Range; label: string }[] = [
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "all", label: "All time" },
];

export default function AttendancePage() {
  const api = useApi();
  const [range, setRange] = useState<Range>("30d");
  const [data, setData] = useState<AttendanceReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api<AttendanceReport>(`/api/attendance?range=${range}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, range]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  const members = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.members ?? []).filter((m) => !q || m.name.toLowerCase().includes(q));
  }, [data, search]);
  const chip = (on: boolean) => `rounded border px-3 py-1 text-sm ${on ? "border-blood-400 bg-blood-700/30" : "border-ink-600 text-stone/70 hover:border-ink-500"}`;
  const rateColor = (r: number | null) => (r === null ? "text-stone/50" : r >= 80 ? "text-green-400" : r >= 50 ? "text-stone" : "text-blood-300");
  const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Attendance</h1>
        <button className="btn-ghost" onClick={() => void load()}>Refresh</button>
      </div>
      <p className="text-sm text-stone/60">
        When a rostered event starts, the dashboard records who is in the briefing voice channel. The rate is the share of events attended, not counting ones a player declined. Events are recorded from now on, so history builds up over time.
      </p>
      <div className="flex gap-1" role="group" aria-label="Time range">{RANGES.map((r) => <button key={r.key} className={chip(range === r.key)} onClick={() => setRange(r.key)}>{r.label}</button>)}</div>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!data && !error && <Skeleton className="h-40 w-full" />}
      {data && data.events.length === 0 && <div className="card p-6 text-center text-sm text-stone/50">No events recorded in this period yet.</div>}

      {data && data.events.length > 0 && (
        <>
          <section className="card overflow-x-auto">
            <div className="flex items-center justify-between gap-2 border-b border-ink-700 p-3">
              <h2 className="font-semibold">Members</h2>
              <input className="input !w-48" placeholder="Search player" aria-label="Search player" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <table className="w-full min-w-[520px] text-left">
              <thead><tr><th className="th">Player</th><th className="th">Rostered</th><th className="th">Attended</th><th className="th">Declined</th><th className="th">No-shows</th><th className="th">Rate</th></tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.discordId} className="border-t border-ink-800 hover:bg-ink-800/50">
                    <td className="px-3 py-1.5 text-sm font-semibold">{m.name}</td>
                    <td className="px-3 py-1.5 text-sm tabular-nums">{m.rostered}</td>
                    <td className="px-3 py-1.5 text-sm tabular-nums">{m.attended}</td>
                    <td className="px-3 py-1.5 text-sm tabular-nums text-stone/60">{m.declined}</td>
                    <td className={`px-3 py-1.5 text-sm tabular-nums ${m.noShows > 0 ? "text-blood-300" : "text-stone/60"}`}>{m.noShows}</td>
                    <td className={`px-3 py-1.5 text-sm font-semibold tabular-nums ${rateColor(m.rate)}`}>{m.rate === null ? "-" : `${m.rate}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card">
            <h2 className="border-b border-ink-700 p-3 font-semibold">Recent events</h2>
            <ul>
              {data.events.map((e) => (
                <li key={e.eventId} className="border-t border-ink-800 px-3 py-2 first:border-t-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">{e.title}</span>
                    <span className="text-xs text-stone/55">{fmt(e.startsAt)} · {e.inVoice} / {e.rostered} in voice</span>
                  </div>
                  {e.noShows.length > 0 && <div className="mt-0.5 text-xs text-blood-300">Not in voice: {e.noShows.join(", ")}</div>}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
