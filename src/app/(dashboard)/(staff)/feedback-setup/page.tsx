"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/client";
import { EmptyState, ErrorBanner, Skeleton, useToast } from "@/components/ui";
import type { ManageEvent } from "@/server/services/scouting";
import { FACTIONS, type Faction } from "@/lib/scouting";

function FactionPicker({ value, onChange, disabled, label }: { value: Faction | null; onChange: (f: Faction | null) => void; disabled: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={label}>
      {(Object.keys(FACTIONS) as Faction[]).map((f) => (
        <button
          key={f}
          type="button"
          role="radio"
          aria-checked={value === f}
          title={FACTIONS[f].label}
          disabled={disabled}
          onClick={() => onChange(value === f ? null : f)}
          className={`rounded-md border p-1 ${value === f ? "border-blood-400 bg-blood-700/30" : "border-ink-600 opacity-60 hover:opacity-100"}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={FACTIONS[f].image} alt={FACTIONS[f].label} className="h-6 w-6 object-contain" />
        </button>
      ))}
    </div>
  );
}

function Row({ e, onChanged }: { e: ManageEvent; onChanged: () => void }) {
  const api = useApi();
  const { toast, node } = useToast();
  const [a, setA] = useState(e.teamA);
  const [b, setB] = useState(e.teamB);
  const [fa, setFa] = useState<Faction | null>(e.factionA);
  const [fb, setFb] = useState<Faction | null>(e.factionB);
  const [busy, setBusy] = useState(false);

  async function act(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      await api("/api/scouting/manage", { method: "POST", body });
      toast({ text: ok, tone: "ok" });
      onChanged();
    } catch (err) {
      toast({ text: (err as Error).message, tone: "err" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="card space-y-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold">{e.title}</div>
          <div className="text-xs text-stone/55">{e.startTime ? new Date(e.startTime * 1000).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "No start time"} · {e.observations} observation{e.observations === 1 ? "" : "s"}</div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.open ? "bg-green-500/15 text-green-400" : e.closed ? "bg-ink-700 text-stone/60" : "bg-ink-800 text-stone/50"}`}>{e.open ? "Open for feedback" : e.closed ? "Closed" : "Not open"}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <FactionPicker value={fa} onChange={setFa} disabled={busy} label="Team 1 faction" />
        <input className="input !w-40" aria-label="Opposing team 1" placeholder="Team 1" value={a} onChange={(x) => setA(x.target.value)} disabled={busy} />
        <span className="text-xs text-stone/50">v</span>
        <FactionPicker value={fb} onChange={setFb} disabled={busy} label="Team 2 faction" />
        <input className="input !w-40" aria-label="Opposing team 2" placeholder="Team 2" value={b} onChange={(x) => setB(x.target.value)} disabled={busy} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={busy || !a.trim() || !b.trim()} onClick={() => void act({ action: "open", eventId: e.eventId, teamA: a, teamB: b, factionA: fa, factionB: fb }, e.open ? "Team details updated" : "Opened for feedback")}>{e.open ? "Save teams" : e.closed ? "Reopen" : "Open for feedback"}</button>
        {e.open && <button className="btn-ghost" disabled={busy} onClick={() => void act({ action: "post", eventId: e.eventId }, "Posted to the event channel on Discord")}>{e.posted ? "Repost to Discord" : "Post to Discord"}</button>}
        {e.open && <button className="btn-ghost" disabled={busy} onClick={() => void act({ action: "close", eventId: e.eventId }, "Feedback closed")}>Close</button>}
      </div>
      {node}
    </li>
  );
}

export default function FeedbackSetupPage() {
  const api = useApi();
  const [events, setEvents] = useState<ManageEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      setEvents((await api<{ events: ManageEvent[] }>("/api/scouting/manage")).events);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  const q = search.trim().toLowerCase();
  const rows = (events ?? []).filter((e) => !q || e.title.toLowerCase().includes(q));

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Feedback setup</h1>
        <button className="btn-ghost" onClick={() => void load()}>Refresh</button>
      </div>
      <p className="text-sm text-stone/60">Open a Raid Helper event for scouting feedback. Team names are read from the title (RMNT v Team A v Team B); correct them if needed. Only players rostered for the event can write observations, and the same team name is merged across matches.</p>
      <input className="input !w-64" placeholder="Search events" aria-label="Search events" value={search} onChange={(e) => setSearch(e.target.value)} />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!events && !error && <Skeleton className="h-40" />}
      {events && rows.length === 0 && <EmptyState title="No events found" />}
      <ul className="space-y-2">{rows.map((e) => <Row key={`${e.eventId}:${e.teamA}:${e.teamB}:${e.open}`} e={e} onChanged={() => void load()} />)}</ul>
    </div>
  );
}
