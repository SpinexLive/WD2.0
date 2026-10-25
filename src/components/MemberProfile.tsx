"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/lib/client";
import "./members.css";
import { Avatar, ErrorBanner, RegBadge, REG_LABEL, Skeleton } from "@/components/ui";

type Reg = keyof typeof REG_LABEL;

interface ProfileMatch {
  id: number; endedAt: string | null; startedAt: string | null; map: string | null; server: string | null; faction: string | null;
  kills: number; deaths: number; kd: number; lobbyKd: number | null; players: number; mvp: boolean; durationS: number | null; cash: number | null;
}
interface Profile {
  member: { id: string; displayName: string; avatarUrl: string };
  steamId: string | null;
  registration?: Reg;
  stats: { name: string | null; kills: number; deaths: number; matches: number; seedingSeconds: number | null; kd: number | null } | null;
  rank: { rank: number; kd: number | null } | null;
  matches: ProfileMatch[];
  history: { syncing: boolean; pending: number; error: string | null; count: number; oldest: string | null; newest: string | null };
  errors: string[];
}

const RED = "#C4495A";
const AMBER = "#D4B06A";
const SAGE = "#8FB59B";
const STONE = "#E8E6E1";
const FACTION_COLORS: Record<string, string> = { lonestar: "#6CB8F0", manticore: "#1FC258", valkyra: "#E0384F" };
const FACTION_LOGOS: Record<string, string> = {
  lonestar: "/images/wardogs-factions-lonestar.webp",
  manticore: "/images/wardogs-factions-manticore.webp",
  valkyra: "/images/wardogs-factions-valkyra.webp",
};
function FactionLogo({ name, size }: { name: string | null; size: number }) {
  const src = FACTION_LOGOS[(name ?? "").toLowerCase()];
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" width={size} height={size} className="shrink-0 object-contain" style={{ width: size, height: size }} /> : null;
}
const GRID = "rgba(232,230,225,0.08)";

const kdOf = (k: number, d: number) => (d === 0 ? k : Math.round((k / d) * 100) / 100);
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "-");
const fmtDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");
const kdColor = (kd: number) => (kd >= 1.5 ? SAGE : kd >= 1 ? AMBER : RED);

function Panel({ title, sub, children, className = "" }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-ink-700 bg-ink-900/60 p-4 ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone/70">{title}</h3>
        {sub && <span className="text-[11px] text-stone/40">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="py-8 text-center text-sm text-stone/40">{children}</p>;

function Tile({ label, value, sub, color, i }: { label: string; value: React.ReactNode; sub?: string; color?: string; i: number }) {
  return (
    <div className="m-card relative overflow-hidden rounded-lg border border-ink-700 bg-ink-900/60 p-3" style={{ "--i": i } as React.CSSProperties}>
      <div className="absolute inset-y-0 left-0 w-0.5 bg-blood-600" />
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone/55">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums leading-none" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="mt-1 truncate text-[11px] text-stone/45">{sub}</div>}
    </div>
  );
}

/** K/D per match as an area line, and the lobby's K/D as a dashed baseline. Hover for a match readout. */
function TrendChart({ data }: { data: ProfileMatch[] }) {
  const W = 640, H = 220, L = 34, R = 44, T = 12, B = 24;
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const vals = data.map((m) => m.kd);
  const max = Math.max(2, Math.ceil(Math.max(...vals, ...data.map((m) => m.lobbyKd ?? 0)) * 2) / 2);
  const cashMax = Math.max(1, ...data.map((m) => m.cash ?? 0));
  const hasCash = data.some((m) => m.cash !== null);
  const yc = (v: number) => T + (1 - v / cashMax) * (H - T - B);
  const x = (i: number) => L + (data.length === 1 ? (W - L - R) / 2 : (i / (data.length - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const line = (arr: number[]) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${line(vals)}L${x(vals.length - 1)},${H - B}L${x(0)},${H - B}Z`;
  const lobby = data.map((m, i) => (m.lobbyKd === null ? null : `${i ? "L" : "M"}${x(i).toFixed(1)},${y(m.lobbyKd).toFixed(1)}`));
  const ticks = [0, 0.5, 1].map((t) => t * max);
  const h = hover !== null ? data[hover]! : null;

  function onMove(e: React.MouseEvent) {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.min(data.length - 1, Math.max(0, Math.round(((px - L) / (W - L - R)) * (data.length - 1)))));
  }

  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="K/D trend per match" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="kdfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={RED} stopOpacity="0.45" /><stop offset="100%" stopColor={RED} stopOpacity="0" /></linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={GRID} /><text x={L - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="rgba(232,230,225,0.45)">{t.toFixed(1)}</text></g>
        ))}
        <line x1={L} x2={W - R} y1={y(1)} y2={y(1)} stroke="rgba(232,230,225,0.22)" strokeDasharray="2 4" />
        <path d={area} fill="url(#kdfill)" />
        <path d={lobby.filter(Boolean).join("")} fill="none" stroke={AMBER} strokeWidth="1.2" strokeDasharray="4 4" opacity="0.7" />
        <path d={line(vals)} fill="none" stroke={RED} strokeWidth="2" strokeLinejoin="round" className="m-draw" pathLength={1} />
        {hasCash && (
          <g>
            {[0, 0.5, 1].map((t) => <text key={t} x={W - R + 6} y={yc(t * cashMax) + 3} fontSize="10" fill={SAGE} opacity="0.8">{Math.round(t * cashMax).toLocaleString()}</text>)}
            <path d={data.flatMap((m, i) => (m.cash === null ? [] : [`${i ? "L" : "M"}${x(i).toFixed(1)},${yc(m.cash).toFixed(1)}`])).join("").replace(/^L/, "M")} fill="none" stroke={SAGE} strokeWidth="1.6" strokeLinejoin="round" />
            {data.map((m, i) => (m.cash === null ? null : <circle key={m.id} cx={x(i)} cy={yc(m.cash)} r={hover === i ? 3.5 : 2} fill={SAGE} stroke="#161616" strokeWidth="1" />))}
          </g>
        )}
        {data.map((m, i) => <circle key={m.id} cx={x(i)} cy={y(m.kd)} r={hover === i ? 4.5 : 2.4} fill={m.mvp ? AMBER : RED} stroke="#161616" strokeWidth="1" />)}
        <text x={L} y={H - 6} fontSize="10" fill="rgba(232,230,225,0.45)">{fmtDate(data[0]!.endedAt)}</text>
        <text x={W - R} y={H - 6} fontSize="10" textAnchor="end" fill="rgba(232,230,225,0.45)">{fmtDate(data[data.length - 1]!.endedAt)}</text>
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="rgba(232,230,225,0.3)" />}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-stone/55">
        <span><i className="mr-1 inline-block h-0.5 w-4 align-middle" style={{ background: RED }} />K/D per match</span>
        {hasCash && <span><i className="mr-1 inline-block h-0.5 w-4 align-middle" style={{ background: SAGE }} />Cash earned (right axis)</span>}
        <span><i className="mr-1 inline-block h-0.5 w-4 align-middle border-t border-dashed" style={{ borderColor: AMBER }} />Lobby K/D</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: AMBER }} />MVP</span>
      </div>
      {h && (
        <div className="pointer-events-none absolute right-2 top-2 rounded-md border border-ink-600 bg-ink-850/95 px-2.5 py-1.5 text-xs shadow-lg">
          <div className="font-semibold">{h.map ?? "Unknown map"} <span className="font-normal text-stone/50">#{h.id}</span></div>
          <div className="text-stone/60">{fmtDateTime(h.endedAt)}</div>
          <div className="tabular-nums">{h.kills} K / {h.deaths} D · <span style={{ color: kdColor(h.kd) }}>{h.kd.toFixed(2)}</span>{h.lobbyKd !== null && <span className="text-stone/50"> (lobby {h.lobbyKd.toFixed(2)})</span>}{h.cash !== null && <span style={{ color: SAGE }}> · ${h.cash.toLocaleString()}</span>}</div>
        </div>
      )}
    </div>
  );
}

function MapBars({ data }: { data: ProfileMatch[] }) {
  const maps = useMemo(() => {
    const by = new Map<string, { n: number; k: number; d: number }>();
    for (const m of data) {
      const key = m.map ?? "Unknown";
      const e = by.get(key) ?? { n: 0, k: 0, d: 0 };
      e.n++; e.k += m.kills; e.d += m.deaths;
      by.set(key, e);
    }
    return [...by].map(([map, e]) => ({ map, n: e.n, kd: kdOf(e.k, e.d) })).sort((a, b) => b.n - a.n || b.kd - a.kd).slice(0, 7);
  }, [data]);
  const max = Math.max(1.5, ...maps.map((m) => m.kd));
  return (
    <div className="space-y-2">
      {maps.map((m) => (
        <div key={m.map}>
          <div className="mb-0.5 flex justify-between text-xs"><span className="truncate">{m.map} <span className="text-stone/40">· {m.n} match{m.n === 1 ? "" : "es"}</span></span><span className="font-semibold tabular-nums" style={{ color: kdColor(m.kd) }}>{m.kd.toFixed(2)}</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-ink-700"><div className="m-grow h-full rounded-full" style={{ width: `${(m.kd / max) * 100}%`, background: kdColor(m.kd) }} /></div>
        </div>
      ))}
    </div>
  );
}

function FactionDonut({ data }: { data: ProfileMatch[] }) {
  const palette = [RED, STONE, AMBER, SAGE];
  const colorFor = (name: string, i: number) => FACTION_COLORS[name.toLowerCase()] ?? palette[i % palette.length]!;
  const slices = useMemo(() => {
    const by = new Map<string, number>();
    for (const m of data) by.set(m.faction ?? "Unknown", (by.get(m.faction ?? "Unknown") ?? 0) + 1);
    return [...by].sort((a, b) => b[1] - a[1]);
  }, [data]);
  const total = data.length;
  const R = 38, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="h-28 w-28 shrink-0 -rotate-90" role="img" aria-label="Matches by faction">
        <circle cx="50" cy="50" r={R} fill="none" stroke="#2a2a2a" strokeWidth="12" />
        {slices.map(([name, n], i) => {
          const len = (n / total) * C;
          const el = <circle key={name} cx="50" cy="50" r={R} fill="none" stroke={colorFor(name, i)} strokeWidth="12" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} />;
          offset += len;
          return el;
        })}
      </svg>
      <ul className="space-y-1 text-xs">
        {slices.map(([name, n], i) => <li key={name} className="flex items-center gap-2"><FactionLogo name={name} size={22} /><i className="h-2.5 w-2.5 rounded-sm" style={{ background: colorFor(name, i) }} />{name}<span className="text-stone/45">{Math.round((n / total) * 100)}%</span></li>)}
      </ul>
    </div>
  );
}

/** When the player's matches start: weekday rows by hour of day, in the viewer's local time. */
function Heatmap({ data }: { data: ProfileMatch[] }) {
  const { grid, max } = useMemo(() => {
    const g = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    for (const m of data) {
      if (!m.startedAt) continue;
      const d = new Date(m.startedAt);
      g[(d.getDay() + 6) % 7]![d.getHours()]!++;
    }
    return { grid: g, max: Math.max(1, ...g.flat()) };
  }, [data]);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: "28px repeat(24, minmax(0, 1fr))" }}>
        {grid.map((row, di) => (
          <div key={di} className="contents">
            <div className="text-[10px] leading-4 text-stone/45">{days[di]}</div>
            {row.map((n, h) => <div key={h} title={`${days[di]} ${String(h).padStart(2, "0")}:00 · ${n} match${n === 1 ? "" : "es"}`} className="aspect-square rounded-[3px]" style={{ background: n ? `rgba(196,73,90,${0.22 + (n / max) * 0.78})` : "rgba(232,230,225,0.05)" }} />)}
          </div>
        ))}
        <div />
        {Array.from({ length: 24 }, (_, h) => <div key={h} className="text-center text-[9px] text-stone/35">{h % 6 === 0 ? h : ""}</div>)}
      </div>
    </div>
  );
}

export default function MemberProfile({ member: memberProp, registration, onClose, endpoint }: { member?: { id: string; displayName: string; avatarUrl: string }; registration?: Reg; onClose?: () => void; endpoint?: string }) {
  const api = useApi();
  const [data, setData] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Without onClose this renders as a normal page (the signed-in user's own stats) instead of a popup.
  const inline = !onClose;
  const member = memberProp ?? data?.member ?? { id: "", displayName: "My stats", avatarUrl: "" };
  const url = endpoint ?? `/api/members/${memberProp?.id ?? ""}`;

  const load = useCallback(
    async (refresh = false) => {
      try {
        setData(await api<Profile>(`${url}${refresh ? "?refresh=1" : ""}`));
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [api, url],
  );
  useEffect(() => void load(), [load]);

  // While match history is still being pulled in, quietly reload every few seconds.
  const syncing = !!data && (data.history.syncing || data.history.pending > 0);
  useEffect(() => {
    if (!syncing) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [syncing, load]);

  // Unlinked members: re-check when they come back from the link page.
  const needsLink = inline && !!data && !data.steamId;
  useEffect(() => {
    if (!needsLink) return;
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    const t = setInterval(() => void load(true), 15000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(t);
    };
  }, [needsLink, load]);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const chrono = useMemo(() => [...(data?.matches ?? [])].reverse(), [data]);
  const derived = useMemo(() => {
    const ms = data?.matches ?? [];
    const cash = ms.flatMap((m) => (m.cash === null ? [] : [m.cash]));
    return { mvps: ms.filter((m) => m.mvp).length, avgCash: cash.length ? Math.round(cash.reduce((a, b) => a + b, 0) / cash.length) : null };
  }, [data]);

  const s = data?.stats;

  return (
    <div className={inline ? "w-full" : "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/85 p-3 backdrop-blur-sm md:p-8"} {...(inline ? {} : { role: "dialog", "aria-modal": true, "aria-label": `${member.displayName} profile`, onMouseDown: (e: React.MouseEvent) => e.target === e.currentTarget && onClose?.() })}>
      <div className={`m-modal card relative w-full p-4 md:p-6 ${inline ? "" : "max-w-6xl"}`}>
        <div className="flex flex-wrap items-center gap-4 border-b border-ink-700 pb-4">
          <Avatar src={member.avatarUrl} size={64} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-2xl font-bold tracking-tight">{member.displayName}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone/60">
              {(registration ?? data?.registration) && <RegBadge status={(registration ?? data?.registration)!} />}
              {data?.steamId && <span className="font-mono">{data.steamId}</span>}
              {s?.name && <span>In game: <span className="text-stone/85">{s.name}</span></span>}
              {data?.rank && <span className="rounded border border-blood-500/60 bg-blood-600/20 px-1.5 py-0.5 font-semibold text-blood-300" title="All-time rank by kills on the Wardogs leaderboard">Server rank #{data.rank.rank}</span>}
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => void load(true)}>Refresh</button>
            {onClose && <button className="btn-primary" onClick={onClose} aria-label="Close profile">Close</button>}
          </div>
        </div>

        {error && <div className="mt-4"><ErrorBanner message={error} onRetry={() => void load()} /></div>}
        {data?.errors.map((e) => <p key={e} className="mt-3 text-xs text-orange">{e}</p>)}

        {inline && data?.registration === "not_registered" && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-900/60 bg-neutral-900 p-4">
            <div>
              <h3 className="font-semibold text-white">Join the Wardogs League</h3>
              <p className="text-sm text-neutral-400">You aren&apos;t registered for the league with REMNANT yet. Apply to join our team.</p>
            </div>
            <a
              href="https://wardogsleague.net/join/rmnt"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
            >
              Join the league
            </a>
          </div>
        )}

        {!data && !error ? (
          <div className="mt-4 space-y-3"><div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div><Skeleton className="h-64" /></div>
        ) : data && !data.steamId ? (
          inline ? (
            <div className="mx-auto mt-6 max-w-xl rounded-xl border border-red-900/60 bg-neutral-900 p-6 text-center">
              <h2 className="text-lg font-semibold text-white">Link your Steam account</h2>
              <p className="mt-2 text-sm text-neutral-400">
                We couldn&apos;t find a Steam account linked to your Discord in Wardogs, so there are no stats to show yet. Link it once with Wardogs and your stats will appear here automatically.
              </p>
              <a
                href="https://wardogsbot.com/link/1332320879073296404"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-block rounded-lg bg-red-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-600"
              >
                Link my account
              </a>
              <p className="mt-3 text-xs text-neutral-500">Opens in a new tab. This page updates when you return.</p>
              <button className="btn-ghost mt-3" onClick={() => void load(true)}>I&apos;ve linked it — check again</button>
            </div>
          ) : (
            <Empty>No Steam account is linked to this member in Wardogs, so there are no stats to show.</Empty>
          )
        ) : data ? (
          <div className="mt-4 space-y-4">
            <p className="text-xs font-medium uppercase tracking-wider text-stone/55">Stats from the REMNANT / Wardogs game server only. Games on other servers aren&apos;t counted.</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              <Tile i={0} label="All-time K/D" value={s?.kd != null ? s.kd.toFixed(2) : "-"} color={s?.kd != null ? kdColor(s.kd) : undefined} sub={s ? `${s.kills.toLocaleString()} K / ${s.deaths.toLocaleString()} D` : "No community record"} />
              <Tile i={1} label="Kills" value={s ? s.kills.toLocaleString() : "-"} />
              <Tile i={2} label="Deaths" value={s ? s.deaths.toLocaleString() : "-"} />
              <Tile i={3} label="Matches" value={s ? s.matches : "-"} sub={`${data.matches.length} in detail`} />
              <Tile i={4} label="MVPs" value={derived.mvps} />
              <Tile i={5} label="Avg cash / match" value={derived.avgCash !== null ? derived.avgCash.toLocaleString() : "-"} sub="Cash earned" />
            </div>

            {chrono.length === 0 ? (
              <Panel title="Match history">
                <Empty>{data.history.syncing || data.history.pending > 0 ? `Reading match history… ${data.history.pending} left` : s && s.matches > 0 ? `${s.matches} match${s.matches === 1 ? "" : "es"} counted in the all-time totals above, but ${s.matches === 1 ? "it" : "they"} predate${s.matches === 1 ? "s" : ""} the dashboard's detailed history. The Wardogs API only exposes the latest 100 matches, so charts will start filling in from the next game ${inline ? "you play" : "they play"}.` : "No stored matches for this player yet."}</Empty>
              </Panel>
            ) : (
              <>
                <div className="grid gap-4 lg:grid-cols-3">
                  <Panel title="K/D trend" sub={`${chrono.length} matches`} className="lg:col-span-2">{chrono.length >= 2 ? <TrendChart data={chrono} /> : <Empty>Need at least 2 matches for a trend.</Empty>}</Panel>
                  <Panel title="Faction split"><FactionDonut data={chrono} /></Panel>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Panel title="Map performance" sub="K/D"><MapBars data={chrono} /></Panel>
                  <Panel title={inline ? "When you play" : "When they play"} sub="local time"><Heatmap data={chrono} /></Panel>
                </div>

                <Panel title="Match history" sub={`${data.matches.length} matches`}>
                  <div className="max-h-80 overflow-auto">
                    <table className="w-full min-w-[560px] text-left">
                      <thead className="sticky top-0 bg-ink-900"><tr><th className="th">Date</th><th className="th">Map</th><th className="th">Faction</th><th className="th">K</th><th className="th">D</th><th className="th">K/D</th><th className="th">Cash</th><th className="th">vs lobby</th></tr></thead>
                      <tbody>
                        {data.matches.map((m) => {
                          const delta = m.lobbyKd === null ? null : m.kd - m.lobbyKd;
                          return (
                            <tr key={m.id} className="border-t border-ink-800 hover:bg-ink-800/50">
                              <td className="whitespace-nowrap px-3 py-1.5 text-xs text-stone/70">{fmtDateTime(m.endedAt)}</td>
                              <td className="px-3 py-1.5 text-sm">{m.map ?? "-"} {m.mvp && <span title="Match MVP" style={{ color: AMBER }}>★</span>}</td>
                              <td className="px-3 py-1.5 text-xs font-medium" style={{ color: FACTION_COLORS[(m.faction ?? "").toLowerCase()] ?? "rgba(232,230,225,0.7)" }}><span className="inline-flex items-center gap-1.5"><FactionLogo name={m.faction} size={20} />{m.faction ?? "-"}</span></td>
                              <td className="px-3 py-1.5 text-sm tabular-nums">{m.kills}</td>
                              <td className="px-3 py-1.5 text-sm tabular-nums">{m.deaths}</td>
                              <td className="px-3 py-1.5 text-sm font-semibold tabular-nums" style={{ color: kdColor(m.kd) }}>{m.kd.toFixed(2)}</td>
                              <td className="px-3 py-1.5 text-sm tabular-nums">{m.cash === null ? "-" : m.cash.toLocaleString()}</td>
                              <td className="px-3 py-1.5 text-xs tabular-nums" style={delta === null ? undefined : { color: delta >= 0 ? SAGE : RED }}>{delta === null ? "-" : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </>
            )}

            <p className="text-[11px] leading-relaxed text-stone/40">
              {data.history.syncing || data.history.pending > 0 ? `Reading match history… ${data.history.pending} match${data.history.pending === 1 ? "" : "es"} left. ` : ""}
              {data.history.error ? `${data.history.error}. ` : ""}
              Detail comes from {data.history.count} stored matches ({fmtDate(data.history.oldest)} to {fmtDate(data.history.newest)}). The Wardogs API only returns the latest 100 matches, so history grows as the dashboard syncs. All-time totals come from the community stats and cover every match.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
