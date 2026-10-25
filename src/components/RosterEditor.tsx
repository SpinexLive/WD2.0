"use client";

import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { useEffect, useMemo, useState } from "react";
import { useApi, type ApiError } from "@/lib/client";
import { movePlayer, newSquad, resizeSquad, setLeader, type PlayerRef } from "@/lib/rosterOps";
import { COMPETITIVE_PLAYER_CAP } from "@/lib/rosterTypes";
import { validateRoster } from "@/lib/rosterValidation";
import type { Roster, SignupInfo, Squad } from "@/lib/rosterTypes";
import { Avatar, Badge, ConfirmDialog, ErrorBanner, Icon, type IconName, RegDot, WarnBanner, categoryIcon, useToast } from "./ui";
import { PublishDialog } from "./PublishDialog";

type SortKey = "name" | "kd";
const fmtKd = (kd: number | null) => (kd === null ? "-" : kd.toFixed(2));
const kdTone = (kd: number | null) => (kd === null ? "text-stone/35" : kd >= 1.5 ? "text-ok" : kd >= 1 ? "text-warn" : "text-blood-300");

interface Props {
  roster: Roster;
  signups: SignupInfo[] | null;
  leagueAvailable: boolean;
  eventTitle: string;
  onReload: () => Promise<void>;
}

function roleIcon(role: string | null): IconName {
  return role && /tentative/i.test(role) ? "pending" : categoryIcon(role ?? "");
}

/** Exact slot under the pointer wins, then the squad card, then the Available list; falls back to rectangle overlap. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length) {
    const rank = (id: string | number) => (String(id).startsWith("slot:") ? 0 : String(id).startsWith("squad:") ? 1 : 2);
    return [...hits].sort((a, b) => rank(a.id) - rank(b.id));
  }
  return rectIntersection(args);
};

function Chip({ id, player, children, dim, role, onDoubleClick }: { id: string; player: PlayerRef; children?: React.ReactNode; dim?: boolean; role?: string | null; onDoubleClick?: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data: player });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} onDoubleClick={onDoubleClick} className={`flex cursor-grab touch-none select-none items-center gap-1.5 rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-[13px] leading-tight hover:border-ink-500 active:cursor-grabbing ${isDragging ? "opacity-30" : ""} ${dim ? "border-warn/60" : ""}`}>
      {role !== undefined && <span className="mr-0.5 inline-flex" title={role ?? "No role"}><Icon name={roleIcon(role)} size={18} /></span>}
      <Avatar src={player.avatarUrl} size={20} />
      {children}
    </div>
  );
}

function SquadCard({ squadId, children }: { squadId: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `squad:${squadId}` });
  return <section ref={setNodeRef} className={`card p-2 transition-shadow ${isOver ? "ring-1 ring-blood-400/70" : ""}`}>{children}</section>;
}

function Slot({ squadId, index, children }: { squadId: string; index: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${squadId}:${index}` });
  return <div ref={setNodeRef} className={`min-h-[28px] rounded border border-dashed p-px transition-colors ${isOver ? "border-blood-400 bg-blood-700/30" : "border-ink-600"}`}>{children}</div>;
}

function ResponseMark({ response }: { response?: "accepted" | "declined" }) {
  const [icon, label] = response === "accepted" ? (["accept", "Confirmed"] as const) : response === "declined" ? (["decline", "Declined"] as const) : (["pending", "Awaiting confirmation"] as const);
  return <span className="shrink-0" title={label} aria-label={label}><Icon name={icon} size={14} /></span>;
}

function Pool({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: "pool" });
  return <div ref={setNodeRef} className={`min-h-0 flex-1 space-y-1 overflow-y-auto rounded p-0.5 ${isOver ? "bg-blood-700/20" : ""}`}>{children}</div>;
}

export function RosterEditor({ roster, signups, leagueAvailable, eventTitle, onReload }: Props) {
  const api = useApi();
  const { toast, node } = useToast();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));

  const [squads, setSquads] = useState<Squad[]>(roster.squads);
  const [settings, setSettings] = useState(roster.settings);
  const [version, setVersion] = useState(roster.version);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [active, setActive] = useState<{ player: PlayerRef; role: string | null } | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "kd", dir: -1 });
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRemind, setConfirmRemind] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newLeader, setNewLeader] = useState(false);
  const [newSize, setNewSize] = useState(2);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const edit = (fn: () => void) => {
    fn();
    setDirty(true);
  };
  const adopt = (r: Roster) => {
    setSquads(r.squads);
    setSettings(r.settings);
    setVersion(r.version);
    setDirty(false);
    setConflict(false);
    setError(null);
  };

  const signupById = useMemo(() => new Map((signups ?? []).map((s) => [s.discordId, s])), [signups]);
  const assigned = useMemo(() => new Set(squads.flatMap((s) => s.slots.flatMap((p) => (p ? [p.discordId] : [])))), [squads]);
  const roleCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of signups ?? []) if (!s.absent && !assigned.has(s.discordId)) m.set(s.role ?? "No role", (m.get(s.role ?? "No role") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [signups, assigned]);
  const unassigned = useMemo(() => {
    const q = search.toLowerCase();
    const list = (signups ?? []).filter((s) => !s.absent && !assigned.has(s.discordId) && (!q || s.name.toLowerCase().includes(q)) && (!roleFilter || (s.role ?? "No role") === roleFilter));
    // Players without a K/D (or deaths) always sort last, whichever direction is chosen.
    const val = (s: SignupInfo) => (sort.key === "kd" ? s.kd : null);
    return list.sort((a, b) => {
      if (sort.key === "name") return a.name.localeCompare(b.name) * sort.dir;
      const x = val(a), y = val(b);
      if (x === null && y === null) return a.name.localeCompare(b.name);
      if (x === null) return 1;
      if (y === null) return -1;
      return (x - y) * sort.dir || a.name.localeCompare(b.name);
    });
  }, [signups, assigned, search, sort, roleFilter]);
  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" ? 1 : -1 }));
  const warnings = useMemo(() => validateRoster({ squads, settings, eventType: roster.eventType }, signups), [squads, settings, roster.eventType, signups]);
  const flagged = useMemo(() => new Set(warnings.filter((w) => w.discordId).map((w) => w.discordId!)), [warnings]);

  function onDragStart(e: DragStartEvent) {
    const player = e.active.data.current as PlayerRef | undefined;
    if (player) setActive({ player, role: signupById.get(player.discordId)?.role ?? null });
  }

  function quickAssign(player: PlayerRef) {
    const open = squads.find((s) => s.slots.some((p, i) => i < s.size && !p));
    if (!open) return toast({ text: "Every squad is full.", tone: "err" });
    edit(() => setSquads((s) => movePlayer(s, player, { kind: "squad", squadId: open.id })));
  }

  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const player = e.active.data.current as PlayerRef | undefined;
    if (!player || !e.over) return;
    const id = String(e.over.id);
    const [kind, squadId, index] = id.split(":");
    const target = kind === "pool" ? ({ kind: "pool" } as const) : kind === "squad" ? ({ kind: "squad", squadId: squadId! } as const) : ({ kind: "slot", squadId: squadId!, index: Number(index) } as const);
    const next = movePlayer(squads, player, target);
    if (next === squads) return toast({ text: "That squad is full.", tone: "err" });
    edit(() => setSquads(next));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ roster: Roster }>(`/api/rosters/${encodeURIComponent(roster.eventId)}`, { method: "PUT", body: { version, settings, squads } });
      adopt(r.roster);
      toast({ text: "Draft saved.", tone: "ok" });
    } catch (e) {
      const err = e as ApiError;
      setConflict(err.code === "conflict");
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    try {
      const r = await api<{ roster: Roster }>(`/api/rosters/${encodeURIComponent(roster.eventId)}/reset`, { method: "POST", body: { version } });
      adopt(r.roster);
      toast({ text: "Roster reset to its template.", tone: "ok" });
    } catch (e) {
      const err = e as ApiError;
      setConflict(err.code === "conflict");
      setError(err.message);
    } finally {
      setSaving(false);
      setConfirmReset(false);
    }
  }

  async function remind() {
    setSaving(true);
    try {
      const r = await api<{ reminded: number }>(`/api/rosters/${encodeURIComponent(roster.eventId)}/remind`, { method: "POST" });
      toast({ text: `Reminder sent to ${r.reminded} player${r.reminded === 1 ? "" : "s"}.`, tone: "ok" });
    } catch (e) {
      toast({ text: (e as ApiError).message, tone: "err" });
    } finally {
      setSaving(false);
      setConfirmRemind(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      await api(`/api/rosters/${encodeURIComponent(roster.eventId)}`, { method: "DELETE", body: { version } });
      await onReload();
    } catch (e) {
      const err = e as ApiError;
      setConflict(err.code === "conflict");
      setError(err.message);
      setSaving(false);
      setConfirmDelete(false);
    }
  }

  const patchSquad = (id: string, p: Partial<Squad>) => edit(() => setSquads((s) => s.map((x) => (x.id === id ? { ...x, ...p } : x))));
  const lastSync = roster.messages.reduce((m, x) => Math.max(m, Date.parse(x.updatedAt ?? x.publishedAt)), 0);
  const unpublishedChanges = roster.status === "published" && Date.parse(roster.updatedAt) > lastSync + 1000;
  const total = squads.reduce((n, s) => n + s.size, 0);
  const counts = useMemo(() => {
    const c = { accepted: 0, declined: 0, pending: 0 };
    for (const id of assigned) c[roster.responses[id] ?? "pending"]++;
    return c;
  }, [assigned, roster.responses]);
  const editing = squads.find((s) => s.id === editingId) ?? null;
  const cap = roster.eventType === "competitive" ? COMPETITIVE_PLAYER_CAP : Infinity;
  const room = (excludeId?: string) => cap - squads.reduce((n, s) => (s.id === excludeId ? n : n + s.size), 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <p className="rounded border border-ink-700 bg-ink-900 p-1.5 text-xs text-stone/60 lg:hidden">The roster editor is optimised for desktop. Drag and drop works best on a larger screen.</p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="truncate text-base font-bold tracking-wide">{eventTitle}</h1>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-stone/60">
            <Badge tone="grey">{roster.eventType === "competitive" ? "Competitive" : "Weekly"}</Badge>
            <Badge tone={roster.status === "published" ? "green" : "amber"}>{roster.status}</Badge>
            {unpublishedChanges && <Badge tone="amber">Unpublished changes</Badge>}
            {dirty && <Badge tone="red">Unsaved edits</Badge>}
            <span>v{version}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button className="btn-ghost" onClick={() => onReload()} disabled={saving}>Sync</button>
          {roster.messages.length > 0 && (
            <button className="btn-ghost" onClick={() => setConfirmRemind(true)} disabled={saving || counts.pending === 0} title={counts.pending === 0 ? "Everyone assigned has responded" : "Ping assigned players who haven't confirmed"}>
              Remind pending ({counts.pending})
            </button>
          )}
          <button className="btn-ghost" onClick={() => setConfirmReset(true)} disabled={saving}>Reset</button>
          <button className="btn-ghost text-blood-300" onClick={() => setConfirmDelete(true)} disabled={saving}>Delete</button>
          <button className="btn-ghost" onClick={save} disabled={saving || !dirty}>{saving ? "Saving…" : "Save draft"}</button>
          <button className="btn-primary" onClick={() => setPublishing(true)} disabled={saving || dirty} title={dirty ? "Save your changes first" : undefined}>
            {roster.messages.length ? "Update Discord Roster" : "Publish to Discord"}
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={conflict ? () => onReload() : undefined} />}
      {conflict && <WarnBanner>Someone else saved this roster. Reloading discards your unsaved edits and shows their version.</WarnBanner>}
      {signups === null && <WarnBanner>Raid Helper sign-ups could not be loaded; sign-up warnings are paused and the Available list is unavailable.</WarnBanner>}
      {signups !== null && !leagueAvailable && settings.warnUnregistered && <WarnBanner>Wardogs League data is unavailable or outdated; registration is shown as Unknown.</WarnBanner>}

      <div className="card flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 text-xs">
        <span className={`font-semibold tabular-nums ${cap !== Infinity && total > cap ? "text-blood-300" : ""}`} title="Assigned players / total positions">{assigned.size}/{total} assigned{cap !== Infinity ? ` (max ${cap})` : ""}</span>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={settings.warnUnregistered} onChange={(e) => edit(() => setSettings({ ...settings, warnUnregistered: e.target.checked }))} />Warn if not registered with Wardogs League</label>
        {roster.messages.length > 0 && (
          <span className="flex items-center gap-2 tabular-nums" title="Confirmations from the Discord roster post">
            <span className="inline-flex items-center gap-1 text-green-400"><Icon name="accept" size={14} />{counts.accepted} confirmed</span>
            <span className="inline-flex items-center gap-1 text-stone/60"><Icon name="pending" size={14} />{counts.pending} pending</span>
            <span className="inline-flex items-center gap-1 text-blood-300"><Icon name="decline" size={14} />{counts.declined} declined</span>
          </span>
        )}
        <form
          className="ml-auto flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim() || squads.length >= 40 || newSize > room()) return;
            edit(() => setSquads((s) => [...s, newSquad(newName.trim(), newSize, newLeader)]));
            setNewName("");
          }}
        >
          <input className="input !w-36 !py-1" placeholder="New squad name" aria-label="New squad name" maxLength={40} value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input className="input !w-14 !py-1" type="number" min={1} max={50} aria-label="Squad size" title="Players" value={newSize} onChange={(e) => setNewSize(Math.min(50, Math.max(1, Number(e.target.value) || 1)))} />
          <label className="flex items-center gap-1"><input type="checkbox" checked={newLeader} onChange={(e) => setNewLeader(e.target.checked)} />SL required</label>
          <button type="submit" className="btn-primary" disabled={!newName.trim() || squads.length >= 40 || newSize > room()} title={newSize > room() ? `Competitive rosters are limited to ${COMPETITIVE_PLAYER_CAP} players` : undefined}>Add squad</button>
        </form>
      </div>

      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
        <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[17rem_1fr]">
          <aside className="card flex max-h-[60vh] min-h-0 flex-col p-2 lg:max-h-none">
            <h2 className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.14em]">Available ({unassigned.length})</h2>
            <input className="input mb-1.5" placeholder="Search sign-ups" aria-label="Search sign-ups" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="mb-1.5 flex flex-wrap gap-1" role="group" aria-label="Filter by role">
              <button type="button" onClick={() => setRoleFilter(null)} className={`rounded border px-1.5 py-0.5 text-[11px] ${roleFilter === null ? "border-blood-400 bg-blood-700/30" : "border-ink-600 text-stone/70 hover:border-ink-500"}`}>All</button>
              {roleCounts.map(([r, n]) => (
                <button key={r} type="button" onClick={() => setRoleFilter(roleFilter === r ? null : r)} title={`Show only ${r}`} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${roleFilter === r ? "border-blood-400 bg-blood-700/30" : "border-ink-600 text-stone/70 hover:border-ink-500"}`}>
                  <Icon name={roleIcon(r === "No role" ? null : r)} size={14} />{r} <span className="text-stone/50">{n}</span>
                </button>
              ))}
            </div>
            <div className="mb-1 flex items-center gap-1.5 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone/50">
              {([["name", "Player"], ["kd", "K/D"]] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => toggleSort(key)} aria-label={`Sort by ${label}`} className={`${key === "name" ? "flex-1 text-left" : "w-9 text-right"} uppercase hover:text-stone ${sort.key === key ? "text-stone" : ""}`}>
                  {label}{sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                </button>
              ))}
            </div>
            <Pool>
              {unassigned.map((s) => (
                <Chip key={s.discordId} id={`p:${s.discordId}`} role={s.role} onDoubleClick={() => quickAssign({ discordId: s.discordId, displayName: s.name, avatarUrl: s.avatarUrl })} player={{ discordId: s.discordId, displayName: s.name, avatarUrl: s.avatarUrl }}>
                  <span className="min-w-0 flex-1 truncate" title={[s.role, s.status].filter(Boolean).join(" · ") || "Signed up"}>{s.name}</span>
                  <RegDot status={s.registration} />
                  <span className={`w-9 text-right text-xs font-semibold tabular-nums ${kdTone(s.kd)}`} title="All-time K/D">{fmtKd(s.kd)}</span>
                </Chip>
              ))}
              {signups !== null && unassigned.length === 0 && <p className="p-2 text-xs text-stone/40">Everyone is assigned (or no sign-ups match).</p>}
            </Pool>
          </aside>

          <div className="min-h-0 overflow-y-auto pr-0.5">
            <div className="grid items-start gap-2 md:grid-cols-2 xl:grid-cols-3">
              {squads.map((sq) => (
                <SquadCard key={sq.id} squadId={sq.id}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Icon name={categoryIcon(sq.category)} size={20} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold leading-tight">{sq.name}</div>
                        <div className="text-[11px] leading-tight text-stone/55">{sq.slots.filter(Boolean).length}/{sq.size}</div>
                      </div>
                    </div>
                    <button className="px-1 text-sm text-stone/50 hover:text-stone" title="Squad settings" aria-label={`Settings for ${sq.name}`} onClick={() => setEditingId(sq.id)}>⚙</button>
                  </div>
                  <div className="space-y-0.5">
                    {sq.slots.map((p, i) => (
                      <Slot key={i} squadId={sq.id} index={i}>
                        {p ? (
                          <Chip id={`p:${p.discordId}`} player={p} dim={flagged.has(p.discordId)} onDoubleClick={() => edit(() => setSquads((s) => movePlayer(s, p, { kind: "pool" })))}>
                            <span className="min-w-0 flex-1 truncate">{p.displayName}</span>
                            {roster.messages.length > 0 && <ResponseMark response={roster.responses[p.discordId]} />}
                            {signupById.get(p.discordId) && <RegDot status={signupById.get(p.discordId)!.registration} />}
                            <button className={`shrink-0 rounded px-0.5 ${p.isLeader ? "" : "opacity-30 grayscale hover:opacity-80"}`} title={p.isLeader ? "Remove squad leader" : "Make squad leader"} onPointerDown={(e) => e.stopPropagation()} onClick={() => edit(() => setSquads((s) => setLeader(s, sq.id, p.discordId)))}><Icon name="leader" size={16} /></button>
                            <button className="px-0.5 text-xs text-stone/50 hover:text-blood-300" title="Return to Available" onPointerDown={(e) => e.stopPropagation()} onClick={() => edit(() => setSquads((s) => movePlayer(s, p, { kind: "pool" })))}>✕</button>
                          </Chip>
                        ) : (
                          <div className="px-1.5 py-0.5 text-[11px] text-stone/35">Empty {i + 1}</div>
                        )}
                      </Slot>
                    ))}
                  </div>
                </SquadCard>
              ))}
            </div>
          </div>
        </div>
        {editing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Squad settings" onMouseDown={(e) => e.target === e.currentTarget && setEditingId(null)}>
            <form className="card w-full max-w-sm border-t-2 border-t-blood-500 p-4 shadow-2xl shadow-black/70" onSubmit={(e) => { e.preventDefault(); setEditingId(null); }}>
              <h2 className="text-base font-bold uppercase tracking-[0.12em]">Squad settings</h2>
              <div className="mt-3 space-y-3 text-xs">
                <label className="block">Name<input autoFocus className="input mt-1" maxLength={40} value={editing.name} onChange={(e) => patchSquad(editing.id, { name: e.target.value, category: e.target.value.toUpperCase() })} /></label>
                <label className="block">Players<input className="input mt-1" type="number" min={1} max={50} value={editing.size} onChange={(e) => { const n = Math.min(50, room(editing.id), Math.max(1, Number(e.target.value) || 1)); edit(() => setSquads((s) => s.map((x) => (x.id === editing.id ? resizeSquad(x, n) : x)))); }} /></label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={editing.leaderRequired} onChange={(e) => patchSquad(editing.id, { leaderRequired: e.target.checked })} />SL required</label>
              </div>
              <div className="mt-4 flex justify-between">
                <button type="button" className="btn-ghost text-blood-300" onClick={() => { const id = editing.id; setEditingId(null); edit(() => setSquads((s) => s.filter((x) => x.id !== id))); }}>Remove squad</button>
                <button type="submit" className="btn-primary">Done</button>
              </div>
            </form>
          </div>
        )}
        <DragOverlay dropAnimation={{ duration: 150 }}>
          {active && (
            <div className="flex w-60 cursor-grabbing items-center gap-1.5 rounded border border-blood-400 bg-ink-700 px-1.5 py-1 text-[13px] shadow-xl shadow-black/60">
              <span className="mr-0.5 inline-flex"><Icon name={roleIcon(active.role)} size={18} /></span>
              <Avatar src={active.player.avatarUrl} size={20} />
              <span className="min-w-0 flex-1 truncate">{active.player.displayName}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <details className="card shrink-0 px-3 py-1.5" open={warnings.some((w) => w.severity === "error")}>
        <summary className={`cursor-pointer text-[11px] font-bold uppercase tracking-[0.14em] ${warnings.length ? "text-warn" : ""}`}>Warnings ({warnings.length})</summary>
        {warnings.length === 0 ? <p className="mt-1 text-xs text-stone/60">No issues found.</p> : (
          <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto text-xs">
            {warnings.map((w, i) => <li key={i} className={w.severity === "error" ? "text-blood-300" : "text-warn"}>{w.severity === "error" ? "✖" : "⚠"} {w.message}</li>)}
          </ul>
        )}
      </details>
      {confirmRemind && (
        <ConfirmDialog title="Remind pending players?" confirmLabel={`Ping ${counts.pending}`} busy={saving} onConfirm={remind} onCancel={() => setConfirmRemind(false)}>
          This posts a message in the roster&apos;s Discord channel that pings the {counts.pending} assigned player{counts.pending === 1 ? "" : "s"} who haven&apos;t confirmed or declined, asking them to respond.
        </ConfirmDialog>
      )}
      {confirmReset && (
        <ConfirmDialog title="Reset roster?" confirmLabel="Reset roster" danger busy={saving} onConfirm={reset} onCancel={() => setConfirmReset(false)}>
          This clears all assignments and restores the template&apos;s squads. It does not change Raid Helper sign-ups or any message already on Discord. Unsaved edits are discarded.
        </ConfirmDialog>
      )}
      {confirmDelete && (
        <ConfirmDialog title="Delete roster?" confirmLabel="Delete roster" danger busy={saving} onConfirm={remove} onCancel={() => setConfirmDelete(false)}>
          This permanently deletes the roster, its squads and assignments{roster.messages.length ? ", and the record of its Discord publication" : ""}. It does not change Raid Helper sign-ups{roster.messages.length ? ", and the message already posted on Discord is left in place and must be removed there by hand" : ""}. You can create a new roster for this event afterwards.
        </ConfirmDialog>
      )}
      {publishing && <PublishDialog eventId={roster.eventId} onClose={() => setPublishing(false)} onDone={(m) => { setPublishing(false); toast({ text: m, tone: "ok" }); void onReload(); }} />}
      {node}
    </div>
  );
}
