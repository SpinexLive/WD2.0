"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi, useLive } from "@/lib/client";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui";
import type { Briefing, BriefingPlayer, BriefingRoster } from "@/server/services/briefing";

const RESPONSE_LABEL: Record<string, string> = { accepted: "Confirmed", declined: "Declined" };
const fmt = (t: number) => new Date(t * 1000).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function PlayerRow({ p, voiceAvailable }: { p: BriefingPlayer; voiceAvailable: boolean }) {
  return (
    <li className="flex items-center gap-3 border-t border-ink-700/60 px-3 py-2">
      {p.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.avatarUrl} alt="" className="h-8 w-8 rounded-full" />
      ) : (
        <div className="h-8 w-8 rounded-full bg-ink-700" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{p.name}{p.isLeader && <span className="ml-1 text-[10px] uppercase text-blood-300">SL</span>}</div>
        <div className="truncate text-xs text-stone/50">{!p.discordId ? "Mercenary" : p.response ? RESPONSE_LABEL[p.response] ?? p.response : "No response"}</div>
      </div>
      {!p.discordId ? <span className="text-xs text-stone/40">Not tracked</span> : !voiceAvailable ? (
        <span className="text-xs text-stone/40">Unknown</span>
      ) : (
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.inVoice ? "bg-green-500/15 text-green-400" : "bg-blood-600/20 text-blood-300"}`}>{p.inVoice ? "In voice" : "Not in voice"}</span>
      )}
    </li>
  );
}

function RosterView({ r, voiceAvailable }: { r: BriefingRoster; voiceAvailable: boolean }) {
  const members = r.players.filter((p) => p.discordId);
  const here = members.filter((p) => p.inVoice).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">{r.title}</h2>
          <div className="text-xs text-stone/55">{fmt(r.startTime)} · {r.status === "published" ? "Published" : "Not published"}</div>
        </div>
        <div className="text-sm tabular-nums"><span className={here === members.length && members.length > 0 ? "text-green-400" : ""}>{here}</span><span className="text-stone/50"> / {members.length} in voice</span></div>
      </div>
      {r.squads.length === 0 ? (
        <EmptyState title="No squads" hint="This roster has no squads yet." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {r.squads.map((s, i) => {
            const filled = s.slots.filter((p): p is BriefingPlayer => !!p);
            const present = filled.filter((p) => p.inVoice).length;
            return (
              <section key={`${s.name}-${i}`} className="card overflow-hidden">
                <header className="flex items-center justify-between gap-2 bg-ink-800/60 px-3 py-2">
                  <h3 className="truncate text-sm font-semibold uppercase tracking-wider">{s.name}</h3>
                  <span className="shrink-0 text-xs tabular-nums text-stone/60">{voiceAvailable ? `${present}/${filled.filter((p) => p.discordId).length} in voice` : `${filled.length}/${s.size}`}</span>
                </header>
                {filled.length === 0 ? <p className="border-t border-ink-700/60 px-3 py-3 text-xs text-stone/45">Empty squad</p> : <ul>{filled.map((p) => <PlayerRow key={p.discordId ?? p.mercenaryId} p={p} voiceAvailable={voiceAvailable} />)}</ul>}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function BriefingPage() {
  const api = useApi();
  const [data, setData] = useState<Briefing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Briefing>("/api/briefing"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);
  useLive(["voice", "roster"], () => void load());

  const current = data?.rosters.find((r) => r.eventId === selected) ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Briefing</h1>
        <button className="btn-ghost" onClick={() => void load()}>Refresh</button>
      </div>
      <p className="text-sm text-stone/60">Pick a roster to see its squads and who is in the briefing voice channel. Updates live.</p>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {data && !data.voiceAvailable && <ErrorBanner message="Voice channel data isn't available yet (the bot is still connecting), so presence is unknown." />}
      {!data && !error && <Skeleton className="h-40 w-full" />}
      {data?.rosters.length === 0 && <EmptyState title="Nothing to brief" hint="No rosters for upcoming events or events from the last 2 hours." />}

      {data && data.rosters.length > 0 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Rosters">
          {data.rosters.map((r) => {
            const here = r.players.filter((p) => p.inVoice).length;
            const on = r.eventId === selected;
            return (
              <button key={r.eventId} role="tab" aria-selected={on} onClick={() => setSelected(on ? null : r.eventId)} className={`rounded-lg border px-3 py-2 text-left transition ${on ? "border-blood-400 bg-blood-700/30" : "border-ink-600 hover:border-ink-500"}`}>
                <div className="max-w-[16rem] truncate text-sm font-semibold">{r.title}</div>
                <div className="text-xs text-stone/55">{fmt(r.startTime)}</div>
                <div className="mt-0.5 text-xs tabular-nums text-stone/60">{here}/{r.players.length} in voice · {r.status === "published" ? "Published" : "Draft"}</div>
              </button>
            );
          })}
        </div>
      )}

      {data && data.rosters.length > 0 && !current && <p className="text-sm text-stone/50">Select a roster above to open it.</p>}
      {data && current && <RosterView r={current} voiceAvailable={data.voiceAvailable} />}
    </div>
  );
}
