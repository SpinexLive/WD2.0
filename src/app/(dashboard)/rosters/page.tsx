"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi, type ApiError } from "@/lib/client";
import { Badge, ConfirmDialog, ErrorBanner, Skeleton } from "@/components/ui";

interface Ev { id: string; title: string; startTime: number | null; signupCount: number | null; status: "upcoming" | "past" | "closed" | "unknown"; discordUrl: string | null; rosterStatus: string | null }
interface Tpl { key: string; name: string; eventType: string; positions: number }
interface Data { events: Ev[]; templates: Tpl[]; source: { fetchedAt: string | null; stale: boolean; error: string | null } }

export default function RostersPage() {
  const api = useApi();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("upcoming");
  const router = useRouter();
  const [picking, setPicking] = useState<Ev | null>(null);
  const [tplKey, setTplKey] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const templates = data?.templates ?? [];
  const chosenKey = tplKey || templates[0]?.key || "";

  async function create() {
    if (!picking) return;
    setCreating(true);
    setCreateError(null);
    try {
      await api(`/api/rosters/${encodeURIComponent(picking.id)}`, { method: "POST", body: { templateKey: chosenKey } });
      router.push(`/rosters/${encodeURIComponent(picking.id)}`);
    } catch (e) {
      setCreateError((e as ApiError).message);
      setCreating(false);
    }
  }

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      try {
        setData(await api<Data>(`/api/events${refresh ? "?refresh=1" : ""}`));
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [api],
  );
  useEffect(() => void load(), [load]);

  const rows = useMemo(() => {
    const q = search.toLowerCase();
    const now = Date.now() / 1000;
    const rank = (e: Ev) => (e.startTime === null ? Infinity : e.startTime >= now ? e.startTime - now : 1e12 + (now - e.startTime));
    return (data?.events ?? [])
      .filter((e) => (status === "all" || e.status === status) && (!q || e.title.toLowerCase().includes(q)))
      .sort((a, b) => rank(a) - rank(b));
  }, [data, search, status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Rosters</h1>
        <div className="flex items-center gap-3">
          <button className="btn-ghost" disabled={loading} onClick={() => load(true)}>{loading ? "Refreshing…" : "Refresh"}</button>
        </div>
      </div>
      {error && <ErrorBanner message={`Could not load Raid Helper events: ${error}`} onRetry={() => load()} />}
      <div className="card">
        <div className="flex flex-wrap gap-2 border-b border-ink-700 p-3">
          <input className="input max-w-xs" placeholder="Search events" aria-label="Search events" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="input w-auto" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="upcoming">Upcoming</option><option value="past">Past</option><option value="closed">Closed</option><option value="all">All</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead><tr className="border-b border-ink-700"><th className="th">Event</th><th className="th">Sign-ups</th><th className="th">Date</th><th className="th">Time</th><th className="th">Roster</th><th className="th" /></tr></thead>
            <tbody>
              {loading && !data
                ? Array.from({ length: 5 }, (_, i) => <tr key={i}><td colSpan={6} className="p-3"><Skeleton className="h-6" /></td></tr>)
                : rows.map((e) => (
                    <tr key={e.id} className="border-b border-ink-800 hover:bg-ink-800/60">
                      <td className="px-3 py-1 text-[13px] font-medium">{e.title}</td>
                      <td className="px-3 py-1 text-[13px] tabular-nums">{e.signupCount ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-1 text-[13px]">{e.startTime ? new Date(e.startTime * 1000).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-1 text-[13px] tabular-nums">{e.startTime ? new Date(e.startTime * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                      <td className="px-3 py-1">{e.rosterStatus ? <Badge tone={e.rosterStatus === "published" ? "green" : "amber"}>{e.rosterStatus}</Badge> : <span className="text-xs text-stone/40">None</span>}</td>
                      <td className="flex gap-1.5 px-3 py-1">
                        {e.rosterStatus
                          ? <Link className="btn-primary !py-0.5" href={`/rosters/${encodeURIComponent(e.id)}`}>Open roster</Link>
                          : <button className="btn-primary !py-0.5" disabled={!data} onClick={() => { setCreateError(null); setPicking(e); }}>Create roster</button>}
                        {e.discordUrl && <a className="btn-ghost !py-0.5" href={e.discordUrl} target="_blank" rel="noreferrer">Discord</a>}
                      </td>
                    </tr>
                  ))}
              {!loading && rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-sm text-stone/60">No events found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {picking && (
        <ConfirmDialog title="Create roster" confirmLabel="Create roster" busy={creating} onConfirm={create} onCancel={() => setPicking(null)}>
          <p className="mb-3 font-semibold text-stone">{picking.title}</p>
          <label className="block text-xs text-stone/60">Template
            <select className="input mt-1" value={chosenKey} onChange={(e) => setTplKey(e.target.value)} aria-label="Roster template">
              {templates.map((t) => <option key={t.key} value={t.key}>{t.name} - {t.positions} positions</option>)}
            </select>
          </label>
          <p className="mt-2 text-xs text-stone/50">Squads can be changed afterwards.</p>
          {createError && <p role="alert" className="mt-2 text-sm text-blood-300">{createError}</p>}
        </ConfirmDialog>
      )}
    </div>
  );
}
