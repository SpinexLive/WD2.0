"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/client";
import Link from "next/link";
import { Avatar, ErrorBanner, REG_LABEL, RegBadge, Skeleton, WarnBanner } from "@/components/ui";
import MemberProfile from "@/components/MemberProfile";
import "./members.css";

type Reg = keyof typeof REG_LABEL;
interface Source { fetchedAt: string | null; stale: boolean; error: string | null; available?: boolean }
interface Member { id: string; displayName: string; avatarUrl: string; registration: Reg; steamId: string | null; kd: number | null; kills: number | null; deaths: number | null; matches: number | null }
interface Application { id: string; discordId: string | null; name: string | null; displayName: string | null; avatarUrl: string | null }
interface LeagueOnly { discordId: string; name: string | null; role: string | null; joinedAt: string | null }
interface Data {
  members: Member[];
  leagueOnly: LeagueOnly[] | null;
  applications: Application[] | null;
  summary: { total: number; registered: number; unregistered: number; unknown: number; pendingApplications: number | null };
  sources: { discord: Source; leagueMembers: Source; leagueApplications: Source; links: Source; statsFailed: number; statsPending?: boolean };
}

type SortKey = "name" | "status" | "steam" | "kd" | "matches";

const SCALE: [number, number, number][] = [[196, 73, 90], [212, 176, 106], [143, 181, 155]];

/** Colour by rank within the current list (low = red, middle = amber, high = sage), so it adapts as the data changes. */
function scaleColor(t: number): string {
  const p = Math.min(Math.max(t, 0), 1) * (SCALE.length - 1);
  const i = Math.min(Math.floor(p), SCALE.length - 2);
  const f = p - i;
  const [a, b] = [SCALE[i]!, SCALE[i + 1]!];
  return `rgb(${[0, 1, 2].map((k) => Math.round(a[k]! + (b[k]! - a[k]!) * f)).join(",")})`;
}

export default function MembersPage() {
  const api = useApi();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | Reg>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "kd" || key === "matches" ? -1 : 1 }));
  const [dismissed, setDismissed] = useState(false);
  const [selected, setSelected] = useState<Member | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      try {
        setData(await api<Data>(`/api/members${refresh ? "?refresh=1" : ""}`));
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

  // While K/D lookups are still filling the cache in the background, quietly reload every 20s without the loading state.
  const historyPending = !!data?.sources.statsPending;
  useEffect(() => {
    if (!historyPending) return;
    const t = setInterval(() => void api<Data>("/api/members").then(setData).catch(() => undefined), 20000);
    return () => clearInterval(t);
  }, [historyPending, api]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (data?.members ?? []).filter((m) => (filter === "all" || m.registration === filter) && (!q || m.displayName.toLowerCase().includes(q) || m.id.includes(q)));
    const { key, dir } = sort;
    const byName = (a: Member, b: Member) => a.displayName.localeCompare(b.displayName);
    // Empty values always sit at the bottom, whichever direction is chosen.
    const num = (a: number | null, b: number | null) => (a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : (a - b) * dir);
    return list.sort((a, b) => {
      if (key === "name") return byName(a, b) * dir;
      if (key === "status") return (a.registration.localeCompare(b.registration) * dir) || byName(a, b);
      if (key === "steam") return (a.steamId === null && b.steamId === null ? 0 : a.steamId === null ? 1 : b.steamId === null ? -1 : a.steamId.localeCompare(b.steamId) * dir) || byName(a, b);
      if (key === "kd") return num(a.kd, b.kd) || byName(a, b);
      if (key === "matches") return num(a.matches, b.matches) || byName(a, b);
      return 0;
    });
  }, [data, search, filter, sort]);

  // Each K/D is coloured by its rank among every member that has one; tied values share a colour.
  const kdColor = useMemo(() => {
    const vals = (data?.members ?? []).flatMap((m) => (m.kd !== null ? [m.kd] : [])).sort((a, b) => a - b);
    return (kd: number) => {
      if (vals.length < 2) return scaleColor(0.5);
      const below = vals.filter((v) => v < kd).length;
      const equal = vals.filter((v) => v === kd).length;
      return scaleColor((below + (equal - 1) / 2) / (vals.length - 1));
    };
  }, [data]);

  const s = data?.summary;
  const cards = [
    ["Total clan members", s?.total],
    ["Registered (Wardogs League)", s?.registered],
    ["Unregistered", s?.unregistered],
    ["Pending applications", s?.pendingApplications],
  ] as const;

  return (
    <div className="flex flex-col gap-4 md:h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Members</h1>
        <button className="btn-ghost" disabled={loading} onClick={() => load(true)}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>

      {data?.leagueOnly && data.leagueOnly.length > 0 && !dismissed && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-blood-500 bg-blood-700/30 shadow-glow p-5">
          <div>
            <div className="text-lg font-bold">Action needed: {data.leagueOnly.length} Wardogs League member{data.leagueOnly.length === 1 ? "" : "s"} to remove</div>
            <p className="mt-1 text-sm text-stone/85">These players are on the Wardogs League team but do not have the clan member role. Review them on the Wardogs League page and remove them on wardogsleague.net.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/wdl" className="btn-primary">View list</Link>
            <button className="btn-ghost" onClick={() => setDismissed(true)}>Dismiss</button>
          </div>
        </div>
      )}
      {error && <ErrorBanner message={error} onRetry={() => load()} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(([label, value], i) => (
          <div key={label} className="card m-card overflow-hidden p-4" style={{ "--i": i } as React.CSSProperties}>
            <div className="absolute inset-y-0 left-0 w-1 bg-blood-600" />
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone/60">{label}</div>
            <div className="mt-1 text-3xl font-bold tracking-tight">{loading && !data ? <Skeleton className="h-8 w-12" /> : <span className="m-num m-pop" style={{ "--i": i } as React.CSSProperties}>{value ?? "Unknown"}</span>}</div>
          </div>
        ))}
      </div>

      {data && (
        <div className="flex flex-col gap-1">
          {(!data.sources.leagueMembers.available || data.sources.leagueMembers.stale || !data.sources.leagueApplications.available || data.sources.leagueApplications.stale) && (
            <WarnBanner>Wardogs League data is unavailable or outdated, so registration statuses are shown as Unknown rather than guessed.</WarnBanner>
          )}
          {(!data.sources.links.available || data.sources.links.stale) && (
            <WarnBanner>Steam links could not be loaded from the Wardogs API{data.sources.links.error ? ` (${data.sources.links.error})` : ""}, so Steam IDs{data.sources.links.available ? " may be out of date" : " are not shown"}.</WarnBanner>
          )}
        </div>
      )}

      <section className="card flex min-h-72 flex-1 flex-col">
        <div className="flex flex-wrap gap-2 border-b border-ink-700 p-3">
          <input className="input m-search max-w-xs" placeholder="Search name or Discord ID" aria-label="Search members" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="input w-auto" aria-label="Filter by status" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">WDL Registration</option>
            {(Object.keys(REG_LABEL) as Reg[]).filter((r) => r !== "unknown").map((r) => <option key={r} value={r}>{REG_LABEL[r]}</option>)}
          </select>
        </div>
        <div className="max-h-[70vh] min-h-0 flex-1 overflow-auto md:max-h-none">
          <table className="m-table w-full min-w-[720px]">
            <thead className="sticky top-0 z-10 bg-ink-850"><tr className="border-b border-ink-700">{(["name:Member", "status:Wardogs League", "steam:Steam ID", "kd:K/D", "matches:Matches"] as const).map((c) => {
              const [key, label] = c.split(":") as [SortKey, string];
              if (key === "status" || key === "steam") return <th key={key} className="th">{label}</th>;
              const active = sort.key === key;
              return (
                <th key={key} className="th" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                  <button type="button" onClick={() => toggleSort(key)} className={`inline-flex items-center gap-1 uppercase tracking-[inherit] hover:text-stone ${active ? "text-stone" : ""}`}>
                    {label}<span aria-hidden="true" className={`m-sort ${active ? "text-blood-400" : "text-stone/25"}`}>{active ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>
                  </button>
                </th>
              );
            })}</tr></thead>
            <tbody>
              {loading && !data
                ? Array.from({ length: 6 }, (_, i) => <tr key={i}><td colSpan={5} className="p-3"><Skeleton className="h-6" /></td></tr>)
                : rows.map((m, i) => (
                    <tr key={m.id} className="m-row cursor-pointer border-b border-ink-800 hover:bg-ink-800/60" style={{ "--i": i } as React.CSSProperties} onClick={() => setSelected(m)}>
                      <td className="px-3 py-1.5"><button type="button" className="flex items-center gap-2.5 text-left hover:text-blood-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-blood-500" aria-label={`Open profile for ${m.displayName}`} onClick={(e) => { e.stopPropagation(); setSelected(m); }}><Avatar src={m.avatarUrl} size={24} /><span className="text-sm">{m.displayName}</span></button></td>
                      <td className="px-3 py-1.5"><RegBadge status={m.registration} /></td>
                      <td className="px-3 py-1.5 text-xs text-stone/75">{m.steamId ?? <span className="text-stone/40">-</span>}</td>
                      <td className="px-3 py-1.5 text-sm font-semibold tabular-nums" style={m.kd !== null ? { color: kdColor(m.kd) } : undefined} title={m.kills !== null ? `${m.kills} kills / ${m.deaths} deaths` : undefined}>{m.kd !== null ? m.kd.toFixed(2) : <span className="font-normal text-stone/40">-</span>}</td>
                      <td className="px-3 py-1.5 text-sm tabular-nums">{m.matches !== null ? m.matches : <span className="text-stone/40">-</span>}</td>
                    </tr>
                  ))}
              {!loading && rows.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-sm text-stone/60">No members match.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {selected && <MemberProfile member={selected} registration={selected.registration} onClose={() => setSelected(null)} />}
    </div>
  );
}