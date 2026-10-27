"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/client";
import { ConfirmDialog, ErrorBanner, Skeleton, useToast } from "@/components/ui";

interface Status {
  channel: { id: string; categoryName: string | null; lastPrice: number | null; lastPriceDate: string | null; lastCheckedAt: string | null; lastError: string | null; createdBy: string } | null;
  categories: { id: string; name: string }[];
  categoriesError: string | null;
}

export default function GoldPanel() {
  const api = useApi();
  const { toast, node } = useToast();
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api<Status>("/api/admin/gold");
      setData(s);
      setCategory((c) => c || s.categories[0]?.id || "");
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast({ text: ok, tone: "ok" });
    } catch (e) {
      toast({ text: (e as Error).message, tone: "err" });
    } finally {
      setBusy(false);
      setConfirmRemove(false);
      await load();
    }
  }

  const c = data?.channel;
  return (
    <div className="space-y-4 p-4">
      <p className="text-sm text-stone/60">
        A voice channel named <span className="font-mono">┊🪙┊Gold Bar $…</span> that shows the day&apos;s gold bar price from wardogshub.gg. It is hidden from everyone except the clan member role, who can see it but not join. The name updates every day at 01:00 UTC.
      </p>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {data?.categoriesError && <ErrorBanner message={data.categoriesError} onRetry={load} />}
      {!data && !error && <Skeleton className="h-24 w-full" />}

      {data && !c && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs uppercase tracking-wider text-stone/55">Category</span>
            <select className="input !w-64" value={category} onChange={(e) => setCategory(e.target.value)}>
              {data.categories.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <button className="btn-primary" disabled={busy || !category} onClick={() => void run(() => api("/api/admin/gold", { method: "POST", body: { categoryId: category } }), "Gold price channel created.")}>
            {busy ? "Creating…" : "Create channel"}
          </button>
        </div>
      )}

      {c && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="card p-3"><div className="text-[10px] uppercase tracking-widest text-stone/55">Today&apos;s price</div><div className="mt-1 text-2xl font-bold tabular-nums">{c.lastPrice !== null ? `$${c.lastPrice.toLocaleString("en-US")}` : "-"}</div><div className="text-[11px] text-stone/45">{c.lastPriceDate ?? "not fetched yet"}</div></div>
            <div className="card p-3"><div className="text-[10px] uppercase tracking-widest text-stone/55">Category</div><div className="mt-1 text-lg font-semibold">{c.categoryName ?? "Unknown"}</div></div>
            <div className="card p-3"><div className="text-[10px] uppercase tracking-widest text-stone/55">Last checked</div><div className="mt-1 text-sm">{c.lastCheckedAt ? new Date(c.lastCheckedAt).toLocaleString("en-GB") : "-"}</div><div className="text-[11px] text-stone/45">Created by {c.createdBy}</div></div>
          </div>
          {c.lastError && <ErrorBanner message={`Last update failed: ${c.lastError}. It retries every 15 minutes.`} />}
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy} onClick={() => void run(() => api("/api/admin/gold", { method: "PUT" }), "Price updated.")}>{busy ? "Updating…" : "Update now"}</button>
            <button className="btn-ghost text-blood-300" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove channel</button>
          </div>
        </div>
      )}

      {confirmRemove && (
        <ConfirmDialog title="Remove gold price channel?" confirmLabel="Remove channel" danger busy={busy} onConfirm={() => void run(() => api("/api/admin/gold", { method: "DELETE" }), "Channel removed.")} onCancel={() => setConfirmRemove(false)}>
          This deletes the voice channel from Discord and stops the daily updates. You can create it again afterwards.
        </ConfirmDialog>
      )}
      {node}
    </div>
  );
}
