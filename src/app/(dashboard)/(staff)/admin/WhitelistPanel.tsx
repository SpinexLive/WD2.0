"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/client";
import { ConfirmDialog, ErrorBanner, Skeleton, useToast } from "@/components/ui";

interface Member { id: string; displayName: string }
interface Data {
  whitelistTotal: number;
  ignoredCount: number;
  pending: boolean;
  unlinked: { steamId: string; name: string | null }[];
  members: Member[];
  allMembers: Member[];
  linked: { steamId: string; name: string | null; discordId: string; member: string; source: "manual" | "auto" }[];
}

function MemberPicker({ members, value, onChange }: { members: Member[]; value: Member | null; onChange: (m: Member | null) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const shown = members.filter((m) => m.displayName.toLowerCase().includes(q.toLowerCase())).slice(0, 50);
  return (
    <div ref={box} className="relative w-64">
      <input
        className="input w-full"
        placeholder="Search members..."
        value={open ? q : value?.displayName ?? ""}
        onFocus={() => { setQ(""); setOpen(true); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
      />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded border border-ink-600 bg-ink-900 shadow-lg">
          {value && <li><button className="w-full px-3 py-1.5 text-left text-sm text-stone/50 hover:bg-ink-700" onClick={() => { onChange(null); setOpen(false); }}>Clear selection</button></li>}
          {shown.map((m) => (
            <li key={m.id}><button className="w-full px-3 py-1.5 text-left text-sm hover:bg-ink-700" onClick={() => { onChange(m); setOpen(false); }}>{m.displayName}</button></li>
          ))}
          {shown.length === 0 && <li className="px-3 py-2 text-sm text-stone/50">No unlinked members match.</li>}
        </ul>
      )}
    </div>
  );
}

export default function WhitelistPanel({ onChanged }: { onChanged: () => void }) {
  const api = useApi();
  const { toast, node } = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, Member | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [ignoring, setIgnoring] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>("/api/admin/whitelist"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => void load(), [load]);
  // Names fill in as the community stats answer, so keep checking while some are missing.
  useEffect(() => {
    if (!data?.pending) return;
    const t = setTimeout(load, 8000);
    return () => clearTimeout(t);
  }, [data, load]);

  async function link(steamId: string) {
    const m = picked[steamId];
    if (!m) return;
    setBusy(steamId);
    try {
      await api("/api/admin/whitelist", { method: "POST", body: { steamId, discordId: m.id } });
      toast({ text: `Linked ${m.displayName}.`, tone: "ok" });
      setPicked((p) => ({ ...p, [steamId]: null }));
      await load();
      onChanged();
    } catch (e) {
      toast({ text: (e as Error).message, tone: "err" });
    } finally {
      setBusy(null);
    }
  }

  async function restoreIgnored() {
    setBusy("restore");
    try {
      const r = await api<{ restored: number }>("/api/admin/whitelist", { method: "PUT" });
      toast({ text: `${r.restored} ignored player${r.restored === 1 ? "" : "s"} shown again.`, tone: "ok" });
      await load();
    } catch (e) {
      toast({ text: (e as Error).message, tone: "err" });
    } finally {
      setBusy(null);
    }
  }

  async function ignore() {
    if (!ignoring) return;
    setBusy(ignoring);
    try {
      await api("/api/admin/whitelist", { method: "PATCH", body: { steamId: ignoring } });
      setIgnoring(null);
      await load();
    } catch (e) {
      toast({ text: (e as Error).message, tone: "err" });
      setIgnoring(null);
    } finally {
      setBusy(null);
    }
  }

  async function unlink(discordId: string) {
    setBusy(discordId);
    try {
      await api("/api/admin/whitelist", { method: "DELETE", body: { discordId } });
      await load();
      onChanged();
    } catch (e) {
      toast({ text: (e as Error).message, tone: "err" });
    } finally {
      setBusy(null);
    }
  }

  if (error) return <div className="p-4"><ErrorBanner message={error} onRetry={load} /></div>;
  if (!data) return <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-8" />)}</div>;

  const f = filter.toLowerCase();
  const rows = data.unlinked.filter((u) => !f || u.steamId.includes(f) || (u.name ?? "").toLowerCase().includes(f));
  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-stone/70">{data.unlinked.length} of {data.whitelistTotal} whitelisted players are not linked to a Discord member. {data.members.length} clan members have no Steam ID.</p>
        <div className="flex items-center gap-2">
          {data.ignoredCount > 0 && <button className="btn-ghost px-3 py-1 text-xs" disabled={busy === "restore"} onClick={restoreIgnored}>Show ignored ({data.ignoredCount})</button>}
          <input className="input w-56" placeholder="Search name or Steam ID..." value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      </div>
      <table className="w-full text-left">
        <thead><tr><th className="th">In-game name</th><th className="th">Steam ID</th><th className="th">Discord member</th><th className="th" /></tr></thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.steamId} className="border-t border-ink-700">
              <td className="px-3 py-1.5 text-sm">{u.name ?? <span className="text-stone/40">{data.pending ? "Loading..." : "Unknown"}</span>}</td>
              <td className="px-3 py-1.5 font-mono text-xs text-stone/60">{u.steamId}</td>
              <td className="px-3 py-1.5"><MemberPicker members={data.members} value={picked[u.steamId] ?? null} onChange={(m) => setPicked((p) => ({ ...p, [u.steamId]: m }))} /></td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right"><button className="btn-primary px-3 py-1 text-xs" disabled={!picked[u.steamId] || busy === u.steamId} onClick={() => link(u.steamId)}>Link</button> <button className="btn-ghost px-2 py-1 text-xs" disabled={busy === u.steamId} onClick={() => setIgnoring(u.steamId)}>Ignore</button></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-sm text-stone/50">Every whitelisted player is linked.</td></tr>}
        </tbody>
      </table>

      {data.linked.length > 0 && (
        <>
          <button className="mb-2 mt-6 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-stone/70 hover:text-stone" aria-expanded={showManual} onClick={() => setShowManual((v) => !v)}>
            <span className={`inline-block transition-transform ${showManual ? "rotate-90" : ""}`}>▸</span> Linked players ({data.linked.length})
          </button>
          {showManual && (
          <table className="w-full text-left">
            <thead><tr><th className="th">In-game name</th><th className="th">Steam ID</th><th className="th">Linked to</th><th className="th">Overwrite with</th><th className="th" /></tr></thead>
            <tbody>
              {data.linked.filter((l) => !f || l.steamId.includes(f) || (l.name ?? "").toLowerCase().includes(f) || l.member.toLowerCase().includes(f)).map((l) => (
                <tr key={l.steamId} className="border-t border-ink-700">
                  <td className="px-3 py-1.5 text-sm">{l.name ?? <span className="text-stone/40">{data.pending ? "Loading..." : "Unknown"}</span>}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-stone/60">{l.steamId}</td>
                  <td className="px-3 py-1.5 text-sm">{l.member} <span className="text-xs text-stone/40">{l.source === "manual" ? "(manual)" : "(Wardogs link)"}</span></td>
                  <td className="px-3 py-1.5"><MemberPicker members={data.allMembers} value={picked[l.steamId] ?? null} onChange={(m) => setPicked((p) => ({ ...p, [l.steamId]: m }))} /></td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    <button className="btn-primary px-3 py-1 text-xs" disabled={!picked[l.steamId] || picked[l.steamId]?.id === l.discordId || busy === l.steamId} onClick={() => link(l.steamId)}>Overwrite</button>{" "}
                    {l.source === "manual" && <button className="btn-ghost px-2 py-1 text-xs" disabled={busy === l.discordId} onClick={() => unlink(l.discordId)}>Unlink</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </>
      )}
      {ignoring && (
        <ConfirmDialog title="Ignore this player?" confirmLabel="Ignore" busy={busy === ignoring} onConfirm={ignore} onCancel={() => setIgnoring(null)}>
          {`Steam ID ${ignoring} is permanently removed from this list and will not be shown again.`}
        </ConfirmDialog>
      )}
      {node}
    </div>
  );
}
