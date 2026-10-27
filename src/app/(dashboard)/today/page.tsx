"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useApi, useLive } from "@/lib/client";
import { EmptyState, ErrorBanner, Skeleton, useToast } from "@/components/ui";
import type { TodayData } from "@/server/services/today";

function useCountdown(startTime: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (startTime === null) return null;
  const s = Math.floor(startTime - now / 1000);
  if (s <= 0) return { live: true, text: "Started" };
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return { live: false, text: d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${String(m).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s` };
}

export default function TodayPage() {
  const api = useApi();
  const { toast, node } = useToast();
  const [data, setData] = useState<TodayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<TodayData>("/api/today"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 120_000);
    return () => clearInterval(t);
  }, [load]);
  useLive(["voice", "roster"], () => void load());

  const next = data?.next ?? null;
  const countdown = useCountdown(next?.startTime ?? null);

  async function respond(response: "accepted" | "declined") {
    if (!next) return;
    setBusy(true);
    try {
      await api("/api/today/respond", { method: "POST", body: { eventId: next.eventId, response } });
      toast({ text: response === "accepted" ? "Confirmed. See you there." : "Marked as declined.", tone: "ok" });
      await load();
    } catch (e) {
      toast({ text: (e as Error).message, tone: "err" });
    } finally {
      setBusy(false);
    }
  }

  const m = data?.latestMatch ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="page-title">Today</h1>
        <button className="btn-ghost" onClick={() => void load()}>Refresh</button>
      </div>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!data && !error && <div className="space-y-3"><Skeleton className="h-40" /><Skeleton className="h-24" /></div>}

      {data && (
        <>
          {next ? (
            <section className="card space-y-3 p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone/60">{next.rostered ? "Your next event" : "Next event"}</div>
              <div className="text-xl font-bold">{next.title}</div>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className={`text-3xl font-bold tabular-nums ${countdown?.live ? "text-green-400" : ""}`}>{countdown?.text}</span>
                <span className="text-sm text-stone/60">{new Date(next.startTime * 1000).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              {next.rostered ? (
                <>
                  <p className="text-sm text-stone/70">You&apos;re on the roster in <span className="font-semibold text-stone">{next.squad}</span>{next.isLeader ? " as squad leader" : ""}.</p>
                  {next.published ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button className="btn-primary" disabled={busy || next.response === "accepted"} onClick={() => void respond("accepted")}>{next.response === "accepted" ? "Confirmed ✓" : "Confirm"}</button>
                      <button className="btn-ghost" disabled={busy || next.response === "declined"} onClick={() => void respond("declined")}>{next.response === "declined" ? "Declined" : "Decline"}</button>
                      {next.response === null && <span className="text-xs text-stone/50">Waiting for your answer</span>}
                    </div>
                  ) : (
                    <p className="text-xs text-stone/50">The roster hasn&apos;t been published yet. You&apos;ll be able to confirm once it is.</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-stone/60">You aren&apos;t on the roster for this one.</p>
              )}
            </section>
          ) : (
            <EmptyState title="No upcoming events" hint="Nothing is scheduled right now. Check back soon." />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <section className="card space-y-1 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone/60">Voice</div>
              {!data.voice.available ? (
                <p className="text-sm text-stone/55">Voice status isn&apos;t available yet.</p>
              ) : (
                <>
                  <p className="text-sm">{data.voice.inChannel ? <>You&apos;re in <span className="font-semibold">{data.voice.inChannel}</span></> : "You aren't in a voice channel."}</p>
                  <p className="text-xs text-stone/55">{data.voice.briefingCount} in the briefing channel right now</p>
                </>
              )}
            </section>
            <section className="card space-y-1 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone/60">Last 30 days</div>
              {data.rank ? (
                <p className="text-sm"><span className="text-2xl font-bold tabular-nums">#{data.rank.rank}</span> <span className="text-stone/60">of {data.rank.of} by kills ({data.rank.kills.toLocaleString()})</span></p>
              ) : (
                <p className="text-sm text-stone/55">{data.linked ? "No matches played in the last 30 days." : "Link your Steam account to see your rank."}</p>
              )}
              <Link href="/leaderboard" className="text-xs text-blood-300 hover:underline">Open leaderboard →</Link>
            </section>
          </div>

          {m ? (
            <section className="card space-y-1 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone/60">Your latest match</div>
              <div className="font-semibold">{m.map ?? "Unknown map"} {m.mvp && <span className="text-amber-300" title="Match MVP">★</span>}</div>
              <div className="text-sm tabular-nums text-stone/70">{m.kills} K / {m.deaths} D · K/D <span className="font-semibold text-stone">{m.kd.toFixed(2)}</span>{m.cash !== null && ` · $${m.cash.toLocaleString()}`}</div>
              <Link href="/me" className="text-xs text-blood-300 hover:underline">See all my stats →</Link>
            </section>
          ) : data.linked ? (
            <EmptyState icon="infantry" title="No matches stored yet" hint="Your stats appear here after you play on the REMNANT server." />
          ) : (
            <EmptyState icon="pending" title="Steam account not linked" hint="Link it once and your stats, rank and matches show up here.">
              <a className="btn-primary mt-1" href="https://wardogsbot.com/link/1332320879073296404" target="_blank" rel="noopener noreferrer">Link my account</a>
            </EmptyState>
          )}
        </>
      )}
      {node}
    </div>
  );
}
