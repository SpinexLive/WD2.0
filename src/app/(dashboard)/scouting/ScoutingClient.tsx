"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/client";
import { EmptyState, ErrorBanner, Skeleton, useToast } from "@/components/ui";
import type { TeamDetail, TeamRow } from "@/server/services/scouting";

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function ScoutingClient({ canDelete = false }: { canDelete?: boolean }) {
  const api = useApi();
  const { toast, node } = useToast();
  const [teams, setTeams] = useState<TeamRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const loadTeams = useCallback(async () => {
    try {
      setTeams((await api<{ teams: TeamRow[] }>("/api/scouting/teams")).teams);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => void loadTeams(), [loadTeams]);

  useEffect(() => {
    setDetail(null);
    if (!selected) return;
    let live = true;
    api<TeamDetail>(`/api/scouting/teams/${encodeURIComponent(selected)}`).then((d) => live && setDetail(d), (e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [api, selected]);

  async function regenerate() {
    if (!selected) return;
    setBusy(true);
    try {
      setDetail(await api<TeamDetail>(`/api/scouting/teams/${encodeURIComponent(selected)}/summary`, { method: "POST" }));
      void loadTeams();
    } catch (e) {
      toast({ text: (e as Error).message, tone: "err" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!selected || !window.confirm("Delete this note permanently? This can't be undone.")) return;
    try {
      await api(`/api/scouting/observations/${id}`, { method: "DELETE" });
      toast({ text: "Note deleted", tone: "ok" });
      void loadTeams();
      const next = await api<TeamDetail>(`/api/scouting/teams/${encodeURIComponent(selected)}`).catch(() => null);
      if (next) setDetail(next);
      else setSelected(null);
    } catch (e) {
      toast({ text: (e as Error).message, tone: "err" });
    }
  }

  const q = search.trim().toLowerCase();
  const rows = (teams ?? []).filter((t) => !q || t.name.toLowerCase().includes(q));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="page-title">Scouting</h1>
      <p className="text-sm text-stone/60">Anonymous observations from our players, grouped by opposing team across every match we&apos;ve played them.</p>
      {error && <ErrorBanner message={error} onRetry={loadTeams} />}
      {!teams && !error && <Skeleton className="h-40" />}
      {teams?.length === 0 && <EmptyState title="No feedback yet" hint="Once players submit observations for an open match, the teams appear here." />}

      {teams && teams.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <div className="space-y-2">
            <input className="input" placeholder="Search teams" aria-label="Search teams" value={search} onChange={(e) => setSearch(e.target.value)} />
            <ul className="card divide-y divide-ink-700/60 overflow-hidden">
              {rows.map((t) => (
                <li key={t.teamKey}>
                  <button onClick={() => setSelected(t.teamKey)} className={`w-full px-3 py-2 text-left hover:bg-ink-800 ${selected === t.teamKey ? "bg-blood-700/20" : ""}`}>
                    <div className="truncate text-sm font-semibold">{t.name}</div>
                    <div className="text-xs text-stone/55">{t.observations} note{t.observations === 1 ? "" : "s"} · {t.matches} match{t.matches === 1 ? "" : "es"} · {fmt(t.lastAt)}{t.stale ? " · new feedback" : ""}</div>
                  </button>
                </li>
              ))}
              {rows.length === 0 && <li className="p-3 text-sm text-stone/50">No teams match.</li>}
            </ul>
          </div>

          <div className="space-y-4">
            {!selected && <p className="text-sm text-stone/50">Select a team to see the overview and every note.</p>}
            {selected && !detail && <Skeleton className="h-48" />}
            {detail && (
              <>
                <section className="card space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-lg font-bold">{detail.name}</h2>
                    <button className="btn-primary" disabled={busy || !detail.aiConfigured} onClick={() => void regenerate()}>{busy ? "Generating…" : detail.summary ? "Refresh overview" : "Generate overview"}</button>
                  </div>
                  {!detail.aiConfigured && <p className="text-xs text-orange">AI overviews aren&apos;t configured on the server yet. The notes below are still available.</p>}
                  {detail.summary ? (
                    <>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{detail.summary.text}</p>
                      <p className="text-xs text-stone/50">AI-generated from {detail.summary.basedOn} note{detail.summary.basedOn === 1 ? "" : "s"} on {fmt(detail.summary.generatedAt)}{detail.summary.basedOn !== detail.observations.length ? ` · ${detail.observations.length - detail.summary.basedOn} newer, refresh to include` : ""}. Check it against the notes below.</p>
                    </>
                  ) : (
                    <p className="text-sm text-stone/55">No overview generated yet.</p>
                  )}
                </section>
                <section className="space-y-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone/60">All notes ({detail.observations.length})</h3>
                  {detail.observations.map((o, i) => (
                    <article key={i} className="card p-3">
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-stone/55">
                        <span>{o.match} · {fmt(o.at)}</span>
                        {canDelete && <button className="text-blood-500 hover:underline" onClick={() => void remove(o.id)}>Delete</button>}
                      </div>
                      <div className="space-y-2">
                        {(["overview", "strengths", "weaknesses", "tactics"] as const).filter((k) => o[k]).map((k) => (
                          <div key={k}>
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-stone/55">{k === "tactics" ? "Tactics" : k}</div>
                            <p className="whitespace-pre-wrap text-sm">{o[k]}</p>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </section>
              </>
            )}
          </div>
        </div>
      )}
      {node}
    </div>
  );
}
