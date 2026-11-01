"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/client";
import { ErrorBanner, useToast } from "@/components/ui";

interface Status {
  enabled: boolean; baseName: string; lastName: string | null; lastRenamedAt: string | null; lastError: string | null;
  live: { currentName: string; scores: string } | null; liveError: string | null; suggestedBase: string | null;
}

export default function ServerNamePanel() {
  const api = useApi();
  const { toast, node } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [baseName, setBaseName] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api<Status>("/api/admin/server-name");
      setStatus(s);
      setBaseName((cur) => cur || s.baseName || s.suggestedBase || "");
      setEnabled(s.enabled);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    setBusy(true);
    try {
      const s = await api<Status>("/api/admin/server-name", { method: "PUT", body: { enabled, baseName } });
      setStatus(s);
      toast({ text: s.lastError ? `Saved, but: ${s.lastError}` : "Saved", tone: s.lastError ? "err" : "ok" });
    } catch (e) {
      toast({ text: (e as Error).message, tone: "err" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 p-4">
      <h2 className="text-lg font-semibold">Live score in server name</h2>
      <p className="text-sm text-stone/60">
        When on, the game server name becomes <span className="font-mono">Base name | L 98ㆍV 45ㆍM 12</span>, updated at most every 2 minutes and only when the score changes.
        The score is shown even at 0-0. Turning it off restores the base name straight away.
      </p>
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-stone/60">Base name</span>
        <input className="input" value={baseName} maxLength={100} onChange={(e) => setBaseName(e.target.value)} disabled={busy} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={busy} />
        Show live score in server name
      </label>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || !baseName.trim()} onClick={() => void save()}>Save</button>
        <button className="btn-ghost" disabled={busy} onClick={() => void load()}>Refresh</button>
        {status?.suggestedBase && <button className="btn-ghost" disabled={busy} onClick={() => setBaseName(status.suggestedBase!)}>Use current server name</button>}
      </div>
      {status && (
        <dl className="space-y-1 text-sm text-stone/70">
          <div>Current in-game name: <span className="font-mono">{status.live?.currentName ?? "unavailable"}</span></div>
          {status.live && <div>Current score: <span className="font-mono">{status.live.scores}</span></div>}
          {status.liveError && <div className="text-red-400">Game server: {status.liveError}</div>}
          {status.lastRenamedAt && <div>Last rename: {new Date(status.lastRenamedAt).toLocaleString()}</div>}
          {status.lastError && <div className="text-red-400">Last error: {status.lastError}</div>}
        </dl>
      )}
      {node}
    </div>
  );
}
