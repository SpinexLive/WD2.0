"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/client";
import { ErrorBanner, Skeleton } from "@/components/ui";
import type { Component } from "@/server/services/monitor";

interface Status { components: Component[]; alertsEnabled: boolean; checkedAt: string }

export default function StatusPanel() {
  const api = useApi();
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      setBusy(true);
      try {
        setData(await api<Status>(`/api/admin/status${refresh ? "?refresh=1" : ""}`));
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [api],
  );
  useEffect(() => void load(), [load]);

  const bad = data?.components.filter((c) => !c.ok).length ?? 0;
  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-stone/60">
          {data ? (bad === 0 ? "Everything is working." : `${bad} problem${bad === 1 ? "" : "s"} found.`) : "Checking…"}{" "}
          {data && (data.alertsEnabled ? "A Discord alert is posted when something fails for an hour." : "Set ALERT_CHANNEL_ID to get a Discord alert when something fails for an hour.")}
        </p>
        <button className="btn-ghost" disabled={busy} onClick={() => void load(true)}>{busy ? "Checking…" : "Check now"}</button>
      </div>
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {!data && !error && <Skeleton className="h-40 w-full" />}
      {data && (
        <ul className="divide-y divide-ink-700 rounded border border-ink-700">
          {data.components.map((c) => (
            <li key={c.key} className="flex items-start gap-3 px-3 py-2.5">
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${c.ok ? "bg-green-400" : "bg-blood-500"}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{c.label} <span className="sr-only">{c.ok ? "working" : "failing"}</span></div>
                {c.detail && <div className={`text-xs ${c.ok ? "text-stone/50" : "text-blood-300"}`}>{c.detail}</div>}
              </div>
              {c.failingSince && <div className="shrink-0 text-xs text-stone/50">since {new Date(c.failingSince).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
