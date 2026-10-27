"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/client";
import { EmptyState, ErrorBanner, Skeleton, useToast } from "@/components/ui";
import type { Fields, MemberEvent } from "@/server/services/scouting";

const SECTIONS = [
  { key: "overview", label: "Overview", hint: "General impression: playstyle, how they approached the match." },
  { key: "strengths", label: "Strengths", hint: "What they did well. Strong players, positions, tactics." },
  { key: "weaknesses", label: "Weaknesses", hint: "Where they were vulnerable or made mistakes." },
  { key: "tactics", label: "Tactics to use against them", hint: "What we should do differently next time." },
] as const;

const EMPTY: Fields = { overview: "", strengths: "", weaknesses: "", tactics: "" };

function TeamBox({ eventId, team, onSaved }: { eventId: string; team: MemberEvent["teams"][number]; onSaved: () => void }) {
  const api = useApi();
  const { toast, node } = useToast();
  const saved = team.mine ?? EMPTY;
  const [vals, setVals] = useState<Fields>(saved);
  const [busy, setBusy] = useState(false);
  const dirty = SECTIONS.some((s) => vals[s.key].trim() !== saved[s.key].trim());
  const hasContent = SECTIONS.some((s) => vals[s.key].trim());

  async function save() {
    setBusy(true);
    try {
      await api("/api/scouting/mine", { method: "POST", body: { eventId, slot: team.slot, ...vals } });
      toast({ text: "Feedback saved", tone: "ok" });
      onSaved();
    } catch (e) {
      toast({ text: (e as Error).message, tone: "err" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-3 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider">{team.name}</h3>
      {SECTIONS.map((s) => (
        <label key={s.key} className="block space-y-1">
          <span className="text-xs font-semibold text-stone/80">{s.label}</span>
          <textarea
            className="input min-h-[80px] w-full"
            maxLength={2000}
            placeholder={s.hint}
            value={vals[s.key]}
            onChange={(e) => setVals((v) => ({ ...v, [s.key]: e.target.value }))}
          />
        </label>
      ))}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-stone/50">Fill in any sections you can · {team.mine ? "You can edit your feedback" : "Not submitted yet"}</span>
        <button className="btn-primary" disabled={busy || !dirty || !hasContent} onClick={() => void save()}>{busy ? "Saving…" : team.mine ? "Update" : "Submit"}</button>
      </div>
      {node}
    </section>
  );
}

export default function ObserveClient() {
  const api = useApi();
  const [events, setEvents] = useState<MemberEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEvents((await api<{ events: MemberEvent[] }>("/api/scouting/mine")).events);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  const current = events?.find((e) => e.eventId === (selected ?? events?.[0]?.eventId)) ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="page-title">Match Feedback</h1>
            <p className="text-sm text-stone/60">Pick the match you played, then tell us what you saw from each opposing team. Your feedback is anonymous to reviewers and is compiled into a briefing for future matches.</p>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!events && !error && <Skeleton className="h-40" />}
      {events?.length === 0 && <EmptyState title="No matches to give feedback on" hint="Staff open a match for feedback after it's played, and you must have been on its roster." />}
      {events && events.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Matches">
            {events.map((e) => {
              const on = e.eventId === current?.eventId;
              const done = e.teams.filter((t) => t.mine).length;
              return (
                <button key={e.eventId} role="tab" aria-selected={on} onClick={() => setSelected(e.eventId)} className={`rounded-lg border px-3 py-2 text-left ${on ? "border-blood-400 bg-blood-700/30" : "border-ink-600 hover:border-ink-500"}`}>
                  <div className="max-w-[18rem] truncate text-sm font-semibold">{e.title}</div>
                  <div className="text-xs text-stone/55">{e.startsAt ? new Date(e.startsAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : ""} · {done}/2 submitted</div>
                </button>
              );
            })}
          </div>
          {current && (
            <div className="grid gap-4 md:grid-cols-2">
              {current.teams.map((t) => <TeamBox key={`${current.eventId}:${t.slot}:${t.name}`} eventId={current.eventId} team={t} onSaved={() => void load()} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
