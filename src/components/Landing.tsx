"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui";
import type { LandingData } from "@/server/services/landing";
import "@/app/login/login.css";

const DISCORD_ICON = "M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.1.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z";

const APPLY_URL = "https://discord.com/channels/1332320879073296404/1354713645975601242";

const DiscordIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d={DISCORD_ICON} /></svg>
);

function countdown(startTime: number, now: number): string {
  const s = Math.floor(startTime - now / 1000);
  if (s <= 0) return "Live now";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

const fmtDate = (t: number) => new Date(t * 1000).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const fmtTime = (t: number) => new Date(t * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
const fmtPosted = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const Panel = ({ id, title, children, right }: { id?: string; title: string; children: React.ReactNode; right?: React.ReactNode }) => (
  <section id={id} className="card scroll-mt-20 overflow-hidden bg-ink-900/85 backdrop-blur">
    <h2 className="card-head justify-between"><span className="flex items-center gap-2">{title}</span>{right}</h2>
    <div className="p-3">{children}</div>
  </section>
);
const Empty = ({ children }: { children: React.ReactNode }) => <p className="py-3 text-sm text-stone/55">{children}</p>;
const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="card bg-ink-900/85 px-4 py-3 text-center backdrop-blur">
    <div className="text-xl font-extrabold tracking-wide text-stone">{value}</div>
    <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-stone/50">{label}</div>
  </div>
);

export function Landing({ initial, signedIn, dashboardHref = "/members" }: { initial: LandingData; signedIn: boolean; dashboardHref?: string }) {
  const [data, setData] = useState(initial);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/public/landing", { cache: "no-store" });
        if (res.ok) setData((await res.json()) as LandingData);
      } catch {
        // Keep showing the last data when a refresh fails.
      }
    }, 30_000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, []);

  const next = data.events?.[0];
  const cta = signedIn ? (
    <a href={dashboardHref} className="btn-primary">{dashboardHref === "/me" ? "My stats" : "Open dashboard"}</a>
  ) : (
    <a href="/login" className="btn-primary gap-2"><DiscordIcon />Sign in with Discord</a>
  );

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-ink-950">
      <div className="login-bg" />
      <div className="login-vignette" />
      <div className="login-grain" />

      <header className="relative z-10 border-b border-ink-700/70 bg-ink-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 lg:px-8">
          <div className="flex items-center gap-3">
            <Image src="/images/icon.png" alt="REMNANT" width={36} height={36} priority />
            <span className="text-lg font-bold tracking-[0.3em] text-stone">REMNANT</span>
          </div>
          <div className="flex items-center gap-2">
            {!signedIn && data.inviteUrl && <a href={data.inviteUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost hidden sm:inline-flex">Join Discord</a>}
            {cta}
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 space-y-5 px-4 py-6 lg:px-8">
        <section id="about" className="card overflow-hidden border-l-4 border-l-blood-600 bg-ink-900/85 backdrop-blur">
          <div className="grid gap-6 p-5 md:p-7 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <h1 className="text-2xl font-extrabold text-stone md:text-3xl">About Us</h1>
              <p className="mt-3 text-sm leading-relaxed text-stone/75">Remant is a gaming community with Hell Let Loose and Wardogs at its heart, but we're not just about one game. We're a friendly, mature bunch from all over Europe who like good company and good games. We ask for the basics: be active, hop on the mic and look out for each other. New members are always welcome, whether you've played for years or only just landed.</p>              <p className="mt-3 text-sm leading-relaxed text-stone/75">Join us on Discord and apply to become a member.</p>
              <div className="mt-4"><a href={data.inviteUrl ?? APPLY_URL} target="_blank" rel="noopener noreferrer" className="btn-primary">Apply to join</a></div>
            </div>
            <ul className="space-y-3 text-sm text-stone/75">
            <li className="flex gap-2"><span className="text-blood-400">▸</span><span><strong className="text-stone">Hell Let Loose:</strong> tournaments and weekly events.</span></li>
              <li className="flex gap-2"><span className="text-blood-400">▸</span><span><strong className="text-stone">Weekly events:</strong> every Tuesday and Thursday.</span></li>
              <li className="flex gap-2"><span className="text-blood-400">▸</span><span><strong className="text-stone">Matches:</strong> Saturday and Sunday evenings.</span></li>
              <li className="flex gap-2"><span className="text-blood-400">▸</span><span><strong className="text-stone">Wardogs League:</strong> competitive matches.</span></li>
            </ul>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Clan members" value={data.memberCount !== null ? String(data.memberCount) : "—"} />
          <Stat label="In voice now" value={data.voice ? String(data.voice.total) : "—"} />
          <Stat label="Upcoming events" value={data.events ? String(data.events.length) : "—"} />
          <Stat label="Players on server" value={data.server?.players != null ? String(data.server.players) : "—"} />
        </div>

        <div className="grid gap-5 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-8">
            <Panel id="events" title="Upcoming events">
              {data.events === null ? (
                <Empty>Events are unavailable right now.</Empty>
              ) : data.events.length === 0 ? (
                <Empty>No events scheduled. Check back soon.</Empty>
              ) : (
                <ul className="divide-y divide-ink-700/70">
                  {data.events.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-stone">{e.title}</div>
                        <div className="text-xs text-stone/55">
                          {now !== null ? `${fmtDate(e.startTime)} · ${fmtTime(e.startTime)}` : "\u00a0"}
                          {e.signupCount !== null && ` · ${e.signupCount} signed up`}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold uppercase tracking-wider text-blood-300">{now !== null ? countdown(e.startTime, now) : ""}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel id="news" title="News">
              {data.news === null ? (
                <Empty>News is unavailable right now.</Empty>
              ) : data.news.length === 0 ? (
                <Empty>No news yet.</Empty>
              ) : (
                <ul className="space-y-4">
                  {data.news.map((n) => (
                    <li key={n.id}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="font-bold text-stone">{n.title}</h3>
                        <span className="text-xs text-stone/50">{fmtPosted(n.createdAt)} · {n.authorName}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-stone/75">{n.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Game server">
              {!data.server ? (
                <Empty>Server status is unavailable right now.</Empty>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate font-semibold text-stone">{data.server.name ?? "REMNANT server"}</div>
                    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${data.server.online ? "border-ok/40 text-ok" : data.server.online === false ? "border-blood-500/50 text-blood-300" : "border-ink-600 text-stone/50"}`}>
                      <span className={`h-2 w-2 rounded-full ${data.server.online ? "bg-ok" : data.server.online === false ? "bg-blood-500" : "bg-stone/30"}`} />
                      {data.server.online ? "Online" : data.server.online === false ? "Offline" : "Unknown"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded border border-ink-700/70 bg-ink-950/50 px-3 py-2">
                      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-stone/45">Players</div>
                      <div className="mt-0.5 text-2xl font-extrabold tabular-nums text-stone">{data.server.players ?? "—"}<span className="text-sm font-semibold text-stone/40"> / 100</span></div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded bg-ink-700"><div className="h-full bg-blood-600" style={{ width: `${Math.min(100, data.server.players ?? 0)}%` }} /></div>
                    </div>
                    <div className="rounded border border-ink-700/70 bg-ink-950/50 px-3 py-2">
                      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-stone/45">Current map</div>
                      <div className="mt-1 text-base font-bold leading-snug text-stone">{data.server.map ?? "—"}</div>
                    </div>
                  </div>
                </div>
              )}
            </Panel>
          </div>

          <div className="lg:col-span-4">
            <Panel title="In voice" right={data.voice && <span className="text-[11px] font-medium normal-case tracking-normal text-stone/55">{data.voice.total} online</span>}>
              {data.voice === null ? (
                <Empty>Voice status is unavailable right now.</Empty>
              ) : data.voice.channels.length === 0 ? (
                <Empty>Nobody is in voice right now.</Empty>
              ) : (
                <ul className="space-y-4">
                  {data.voice.channels.map((c) => (
                    <li key={c.id}>
                      <div className="flex items-center justify-between border-b border-ink-700/70 pb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-stone/55">
                        <span className="truncate">🔊 {c.name}</span><span>{c.members.length}</span>
                      </div>
                      <ul className="mt-2 space-y-1.5">
                        {c.members.map((m) => (
                          <li key={m.id} className="flex items-center gap-2.5 text-sm"><Avatar src={m.avatarUrl} size={26} /><span className="truncate text-stone">{m.name}</span></li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </main>

      <footer className="relative z-10 border-t border-ink-700/70 py-5 text-center text-xs text-stone/45">
        <a href="/privacy" className="hover:text-stone">Privacy Policy</a> · <a href="/terms" className="hover:text-stone">Terms &amp; Conditions</a>
        <div className="mt-1">© 2026 REMNANT. All rights reserved.</div>
      </footer>
    </div>
  );
}
