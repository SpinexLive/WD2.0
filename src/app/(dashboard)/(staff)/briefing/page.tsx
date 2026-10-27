"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/client";
import { ErrorBanner, Skeleton } from "@/components/ui";
import type { Briefing } from "@/server/services/briefing";

const RESPONSE_LABEL: Record<string, string> = { accepted: "Confirmed", declined: "Declined" };

export default function BriefingPage() {
  const api = useApi();
  const [data, setData] = useState<Briefing | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Briefing</h1>
        <button className="btn-ghost" onClick={() => void load()}>Refresh</button>
      </div>
      <p className="text-sm text-stone/60">
        Rosters for upcoming events and events that started in the last 2 hours, checked against the briefing voice channel. Updates every 15 seconds.
      </p>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {data && !data.voiceAvailable && <ErrorBanner message="Voice channel data isn't available yet (the bot is still connecting), so presence is unknown." />}
      {!data && !error && <Skeleton className="h-40 w-full" />}
      {data?.rosters.length === 0 && <div className="card p-6 text-center text-sm text-stone/50">No rosters for upcoming events or events from the last 2 hours.</div>}

      {data?.rosters.map((r) => {
        const here = r.players.filter((p) => p.inVoice).length;
        return (
          <section key={r.eventId} className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 p-3">
              <div>
                <div className="font-semibold">{r.title}</div>
                <div className="text-xs text-stone/55">
                  {new Date(r.startTime * 1000).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {r.status === "published" ? "Published" : "Not published"}
                </div>
              </div>
              <div className="text-sm tabular-nums">
                <span className={here === r.players.length && r.players.length > 0 ? "text-green-400" : "text-stone"}>{here}</span>
                <span className="text-stone/50"> / {r.players.length} in voice</span>
              </div>
            </header>
            {r.players.length === 0 ? (
              <div className="p-4 text-sm text-stone/50">No players assigned.</div>
            ) : (
              <ul className="grid sm:grid-cols-2">
                {r.players.map((p) => (
                  <li key={p.discordId} className="flex items-center gap-3 border-b border-ink-700/60 px-3 py-2">
                    {p.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.avatarUrl} alt="" className="h-8 w-8 rounded-full" />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-ink-700" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.name}{p.isLeader && <span className="ml-1 text-[10px] uppercase text-blood-300">SL</span>}</div>
                      <div className="truncate text-xs text-stone/50">{p.squad}{p.response ? ` · ${RESPONSE_LABEL[p.response] ?? p.response}` : ""}</div>
                    </div>
                    {!data.voiceAvailable ? (
                      <span className="text-xs text-stone/40">Unknown</span>
                    ) : (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.inVoice ? "bg-green-500/15 text-green-400" : "bg-blood-600/20 text-blood-300"}`}>
                        {p.inVoice ? "In voice" : "Not in voice"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
