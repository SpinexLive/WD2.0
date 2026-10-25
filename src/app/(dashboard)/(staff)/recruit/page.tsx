"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/client";
import { ErrorBanner, Skeleton, useToast } from "@/components/ui";
import type { RecruitReport } from "@/server/services/recruit";

type Tab = "new" | "contacted" | "dismissed";
const TABS: { key: Tab; label: string }[] = [
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "dismissed", label: "Dismissed" },
];

export default function RecruitPage() {
  const api = useApi();
  const { toast, node } = useToast();
  const [data, setData] = useState<RecruitReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("new");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api<RecruitReport>("/api/recruit"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  async function mark(steamId: string, status: Tab, note?: string) {
    setBusy(steamId);
    try {
      await api(`/api/recruit/${steamId}`, { method: "PUT", body: { status, ...(note ? { note } : {}) } });
      await load();
    } catch (e) {
      toast({ text: (e as Error).message, tone: "err" });
    } finally {
      setBusy(null);
    }
  }

  const counts = useMemo(() => {
    const c = { new: 0, contacted: 0, dismissed: 0 };
    for (const x of data?.candidates ?? []) c[x.status]++;
    return c;
  }, [data]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.candidates ?? []).filter((c) => c.status === tab && (!q || (c.name ?? "").toLowerCase().includes(q) || c.steamId.includes(q)));
  }, [data, tab, search]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Recruit</h1>
        <button className="btn-ghost" onClick={() => void load()}>Refresh</button>
      </div>
      <p className="text-sm text-stone/60">
        Players on the game server with at least {data?.minMatches ?? 5} stored matches whose K/D and average cash are within 10% of our top 10 clan members. Anyone already linked to a clan member is excluded. Stats cover the Wardogs game server only.
      </p>
      {error && <ErrorBanner message={error} onRetry={load} />}

      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="card p-3"><div className="text-[10px] uppercase tracking-widest text-stone/55">Top {data.benchmark.players} K/D</div><div className="mt-1 text-2xl font-bold tabular-nums">{data.benchmark.kd.toFixed(2)}</div></div>
          <div className="card p-3"><div className="text-[10px] uppercase tracking-widest text-stone/55">Top {data.benchmark.players} avg cash</div><div className="mt-1 text-2xl font-bold tabular-nums">{data.benchmark.avgCash.toLocaleString()}</div></div>
          <div className="card p-3"><div className="text-[10px] uppercase tracking-widest text-stone/55">Minimum K/D</div><div className="mt-1 text-2xl font-bold tabular-nums">{data.benchmark.minKd.toFixed(2)}</div></div>
          <div className="card p-3"><div className="text-[10px] uppercase tracking-widest text-stone/55">Minimum avg cash</div><div className="mt-1 text-2xl font-bold tabular-nums">{data.benchmark.minCash.toLocaleString()}</div></div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`rounded border px-3 py-1 text-sm ${tab === t.key ? "border-blood-400 bg-blood-700/30" : "border-ink-600 text-stone/70 hover:border-ink-500"}`}>
              {t.label} <span className="text-stone/50">{data ? counts[t.key] : "-"}</span>
            </button>
          ))}
        </div>
        <input className="input !w-56" placeholder="Search name or Steam ID" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {!data && !error && <div className="space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>}
      {data && rows.length === 0 && <p className="text-sm text-stone/55">{tab === "new" ? "No new candidates meet the bar right now. Candidates appear as the dashboard stores more matches." : "Nobody here."}</p>}

      {rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead><tr><th className="th">Player</th><th className="th">Steam ID</th><th className="th">Matches</th><th className="th">K/D</th><th className="th">Avg cash</th><th className="th">MVPs</th><th className="th">Last played</th><th className="th" /></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.steamId} className="border-t border-ink-800 align-top">
                  <td className="px-3 py-2 text-sm font-semibold">{c.name ?? "Unknown"}{c.note && <div className="text-xs font-normal text-stone/55">{c.note}</div>}{c.updatedBy && c.status !== "new" && <div className="text-[11px] font-normal text-stone/40">{c.status} by {c.updatedBy}</div>}</td>
                  <td className="px-3 py-2"><button className="font-mono text-xs text-stone/75 hover:text-stone" title="Copy Steam ID" onClick={() => void navigator.clipboard.writeText(c.steamId).then(() => toast({ text: "Steam ID copied.", tone: "ok" }))}>{c.steamId}</button></td>
                  <td className="px-3 py-2 text-sm tabular-nums">{c.matches}</td>
                  <td className="px-3 py-2 text-sm font-semibold tabular-nums">{c.kd.toFixed(2)}<div className="text-[11px] font-normal text-stone/45">{c.kills}K / {c.deaths}D</div></td>
                  <td className="px-3 py-2 text-sm tabular-nums">{c.avgCash?.toLocaleString() ?? "-"}</td>
                  <td className="px-3 py-2 text-sm tabular-nums">{c.mvps}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-stone/70">{c.lastPlayed ? new Date(c.lastPlayed).toLocaleDateString("en-GB") : "-"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      {c.status !== "contacted" && <button className="btn-ghost !py-1" disabled={busy === c.steamId} onClick={() => void mark(c.steamId, "contacted", window.prompt("Optional note (e.g. who contacted them):") ?? undefined)}>Contacted</button>}
                      {c.status !== "dismissed" && <button className="btn-ghost !py-1" disabled={busy === c.steamId} onClick={() => void mark(c.steamId, "dismissed")}>Dismiss</button>}
                      {c.status !== "new" && <button className="btn-ghost !py-1" disabled={busy === c.steamId} onClick={() => void mark(c.steamId, "new")}>Restore</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {node}
    </div>
  );
}
