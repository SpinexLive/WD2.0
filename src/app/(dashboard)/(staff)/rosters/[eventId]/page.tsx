"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { useApi, useApp, useLive, type ApiError } from "@/lib/client";
import { ErrorBanner, Skeleton } from "@/components/ui";
import { RosterEditor } from "@/components/RosterEditor";
import type { Roster, RosterTemplate, SignupInfo } from "@/lib/rosterTypes";

interface Data {
  event: { id: string; title: string; startTime: number | null } | null;
  eventError: string | null;
  eventSource: { fetchedAt: string | null; stale: boolean; error: string | null } | null;
  signups: SignupInfo[] | null;
  leagueAvailable: boolean;
  roster: Roster | null;
  templates: RosterTemplate[];
}

export default function RosterPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const api = useApi();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState("");
  const [creating, setCreating] = useState(false);
  const chosenKey = templateKey || data?.templates[0]?.key || "";

  const load = useCallback(
    async (refresh = false) => {
      try {
        setData(await api<Data>(`/api/rosters/${encodeURIComponent(eventId)}${refresh ? "?refresh=1" : ""}`));
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [api, eventId],
  );
  useEffect(() => void load(), [load]);

  // Players confirm in Discord, so pick up their responses as they arrive (never replaces unsaved edits).
  const { user } = useApp();
  const [elsewhere, setElsewhere] = useState(false);
  const refreshResponses = useCallback(async () => {
    try {
      const next = await api<Data>(`/api/rosters/${encodeURIComponent(eventId)}`);
      setData((prev) => {
        if (!prev?.roster || !next.roster) return prev;
        if (prev.roster.version === next.roster.version) return { ...prev, roster: { ...prev.roster, responses: next.roster.responses } };
        if (next.roster.lastEditorId !== user.id) setElsewhere(true);
        return prev;
      });
    } catch {
      // A failed background refresh should not raise an error banner.
    }
  }, [api, eventId, user.id]);
  useLive(["roster"], (d) => {
    if (!d.eventId || d.eventId === eventId) void refreshResponses();
  });
  const published = data?.roster?.status === "published";
  useEffect(() => {
    if (!published) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refreshResponses();
    }, 60_000);
    return () => clearInterval(timer);
  }, [published, refreshResponses]);

  async function create() {
    setCreating(true);
    try {
      await api(`/api/rosters/${encodeURIComponent(eventId)}`, { method: "POST", body: { templateKey: chosenKey } });
      await load();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setCreating(false);
    }
  }

  const back = <Link href="/rosters" className="text-sm text-stone/60 hover:text-blood-300">← All events</Link>;

  if (!data && !error) return <div className="space-y-3">{back}<Skeleton className="h-10 w-1/2" /><Skeleton className="h-64" /></div>;
  if (!data) return <div className="space-y-3">{back}<ErrorBanner message={error!} onRetry={() => load()} /></div>;

  const title = data.event?.title ?? `Event ${eventId}`;

  return (
    <div className="flex flex-col gap-2 md:h-[calc(100vh-5rem)] md:min-h-0">
      {back}
      {data.eventError && <ErrorBanner message={`Raid Helper event data unavailable: ${data.eventError}`} onRetry={() => load(true)} />}
      {error && <ErrorBanner message={error} />}
      {elsewhere && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-blood-500/60 bg-blood-600/10 p-2 text-sm">
          <span>Someone else changed this roster.</span>
          <button className="btn-ghost" onClick={() => { setElsewhere(false); void load(true); }}>Load latest (discards your unsaved edits)</button>
        </div>
      )}
      {data.roster ? (
        <RosterEditor key={`${data.roster.id}:${data.roster.version}`} roster={data.roster} signups={data.signups} leagueAvailable={data.leagueAvailable} eventTitle={title} onReload={() => load(true)} />
      ) : (
        <div className="card max-w-lg space-y-4 p-5">
          <h1 className="page-title">{title}</h1>
          <p className="text-sm text-stone/60">No roster exists for this event yet. Choose a template to start from (the default is the 32-player Hotzone layout); squads can be changed afterwards.</p>
          <select className="input"           value={chosenKey} onChange={(e) => setTemplateKey(e.target.value)} aria-label="Roster template">
                      {data.templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                    </select>
                    <button className="btn-primary" disabled={!chosenKey || creating} onClick={create}>{creating ? "Creating…" : "Create roster"}</button>
        </div>
      )}
    </div>
  );
}
