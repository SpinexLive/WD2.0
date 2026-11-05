"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi, useLive, type ApiError } from "@/lib/client";
import { Avatar, ConfirmDialog, EmptyState, ErrorBanner, Skeleton, useToast } from "@/components/ui";
import { GROUP_LABELS, LOADOUT_ITEMS, itemImage, type LoadoutGroup } from "@/lib/loadout";

interface Table {
  config: { channelId: string; messageId: string; postedAt: string } | null;
  members: { id: string; name: string; avatarUrl: string | null; items: string[] }[];
  canSendReminder: boolean;
}

interface ReminderPreview { count: number; previewDigest: string; trackerUrl: string | null }

export default function LoadoutPage() {
  const api = useApi();
  const { toast, node } = useToast();
  const [data, setData] = useState<Table | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [reminderPreview, setReminderPreview] = useState<ReminderPreview | null>(null);
  const [reminderError, setReminderError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Table>("/api/loadout"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => void load(), [load]);
  useLive(["loadout"], () => void load());

  async function run(path: string, body: unknown, ok: string) {
    setBusy(true);
    try {
      await api(path, { method: "POST", body });
      toast({ text: ok, tone: "ok" });
      await load();
    } catch (e) {
      toast({ text: (e as Error).message, tone: "err" });
    } finally {
      setBusy(false);
      setConfirmReset(false);
    }
  }

  async function prepareReminder() {
    setBusy(true);
    setReminderError(null);
    try {
      const preview = await api<ReminderPreview>("/api/loadout/remind");
      if (preview.count === 0) toast({ text: "No members need a reminder.", tone: "ok" });
      else setReminderPreview(preview);
    } catch (e) {
      setReminderError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendReminder() {
    if (!reminderPreview || !reminderPreview.count) return;
    setBusy(true);
    setReminderError(null);
    try {
      const result = await api<{ reminded: number }>("/api/loadout/remind", {
        method: "POST",
        body: { previewDigest: reminderPreview.previewDigest, requestId: crypto.randomUUID() },
      });
      toast({ text: `Reminder sent to ${result.reminded} member${result.reminded === 1 ? "" : "s"}.`, tone: "ok" });
    } catch (e) {
      const error = e as ApiError;
      setReminderError(error.status === 0 ? "Could not confirm whether the reminder was sent. Check the Discord channel before retrying." : error.message);
    } finally {
      setBusy(false);
      setReminderPreview(null);
    }
  }

  const q = search.trim().toLowerCase();
  const rows = useMemo(() => (data?.members ?? []).filter((m) => !q || m.name.toLowerCase().includes(q)).sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name)), [data, q]);
  const counts = useMemo(() => new Map(LOADOUT_ITEMS.map((i) => [i.key, (data?.members ?? []).filter((m) => m.items.includes(i.key)).length])), [data]);
  const groups = (Object.keys(GROUP_LABELS) as LoadoutGroup[]).map((g) => ({ g, items: LOADOUT_ITEMS.filter((i) => i.group === g) }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Loadout unlocks</h1>
        <button className="btn-ghost" onClick={() => void load()}>Refresh</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-ghost" disabled={busy} onClick={() => setConfirmReset(true)}>Reset all unlocks</button>
        {data?.canSendReminder && <button className="btn-ghost" disabled={busy} onClick={() => void prepareReminder()}>Remind members</button>}
        <span className="text-xs text-stone/50">{data?.config ? "Embed is posted." : "Embed not posted yet."} Channel settings are under Admin → Loadout.</span>
      </div>
      <input className="input !w-64" placeholder="Search members" aria-label="Search members" value={search} onChange={(e) => setSearch(e.target.value)} />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {reminderError && <ErrorBanner message={reminderError} />}
      {!data && !error && <Skeleton className="h-64" />}
      {data && rows.length === 0 && <EmptyState title="No members found" />}
      {data && rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-600">
                <th rowSpan={2} className="sticky left-0 bg-ink-800 p-2 text-left align-bottom">Member</th>
                {groups.map(({ g, items }) => <th key={g} colSpan={items.length} className="border-l border-ink-600 p-1 text-xs uppercase tracking-wider text-stone/60">{GROUP_LABELS[g]}</th>)}
              </tr>
              <tr className="border-b border-ink-600">
                {groups.flatMap(({ items }) => items).map((i) => (
                  <th key={i.key} className="border-l border-ink-700 p-1 text-center" title={i.name}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={itemImage(i)} alt={i.name} className="mx-auto h-9 w-16 object-contain" />
                    <div className="text-[10px] font-normal text-stone/50">{counts.get(i.key)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-b border-ink-700/60 hover:bg-ink-800/60">
                  <td className="sticky left-0 bg-ink-900 p-2"><span className="flex items-center gap-2 whitespace-nowrap"><Avatar src={m.avatarUrl} size={24} />{m.name}</span></td>
                  {LOADOUT_ITEMS.map((i) => (
                    <td key={i.key} className="border-l border-ink-700 text-center">
                      {m.items.includes(i.key) ? <span className="font-bold text-green-400" aria-label={`${i.name} unlocked`}>✓</span> : <span className="text-stone/20" aria-hidden>·</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirmReset && (
        <ConfirmDialog title="Reset all unlocks?" confirmLabel="Reset everything" danger busy={busy} onCancel={() => setConfirmReset(false)} onConfirm={() => void run("/api/loadout/reset", {}, "All unlocks cleared")}>
          This removes every confirmed unlock for every member. It can't be undone.
        </ConfirmDialog>
      )}
      {reminderPreview && (
        <ConfirmDialog title="Send unlock reminder?" confirmLabel={`Remind ${reminderPreview.count} member${reminderPreview.count === 1 ? "" : "s"}`} busy={busy} onCancel={() => setReminderPreview(null)} onConfirm={() => void sendReminder()}>
          <p>
            This will ping {reminderPreview.count} member{reminderPreview.count === 1 ? "" : "s"} with no recorded unlocks in Discord channel 1566382614519218286.
            Only members with the Wardogs member role are included. Recipients are checked again before sending.
          </p>
          {!reminderPreview.trackerUrl && <p className="mt-2">No tracker embed is configured, so the reminder will not contain a direct tracker link.</p>}
        </ConfirmDialog>
      )}
      {node}
    </div>
  );
}
