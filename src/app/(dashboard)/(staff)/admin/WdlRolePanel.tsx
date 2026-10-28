"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/client";
import { ErrorBanner, Skeleton, useToast } from "@/components/ui";

interface Status {
  roleId: string | null;
  roles: { id: string; name: string }[];
  rolesError: string | null;
  lastSyncedAt: string | null;
  lastAdded: number;
  lastError: string | null;
}
interface Result { ok: boolean; added: number; error?: string | null; disabled?: boolean }

export default function WdlRolePanel() {
  const api = useApi();
  const { toast, node } = useToast();
  const [data, setData] = useState<Status | null>(null);
  const [roleId, setRoleId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const status = await api<Status>("/api/admin/wdl-role");
      setData(status);
      setRoleId(status.roleId ?? "");
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [api]);
  useEffect(() => void load(), [load]);

  async function run(save: boolean) {
    setBusy(true);
    try {
      const result = await api<Result>("/api/admin/wdl-role", save
        ? { method: "PUT", body: { roleId: roleId || null } }
        : { method: "POST" });
      toast({ text: result.error
        ? `${save ? "Selection saved. " : ""}${result.added} role(s) assigned. ${result.error}`
        : result.disabled ? "Automatic WDL role assignment disabled."
        : `${save ? "Selection saved. " : ""}${result.added} role(s) assigned.`, tone: result.ok ? "ok" : "err" });
    } catch (e) { toast({ text: (e as Error).message, tone: "err" }); }
    finally { await load(); setBusy(false); }
  }

  return (
    <div className="space-y-4 p-4">
      <p className="text-sm text-stone/60">Choose a Discord role for clan members linked to the accepted WDL team roster. Matching uses their Discord ID; pending applications do not qualify. Saving assigns the role now, then checks every five minutes.</p>
      <p className="text-sm text-stone/60">Roles are only added. Disabling this setting or choosing a different role leaves previously assigned roles in place.</p>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!data && !error && <Skeleton className="h-24 w-full" />}
      {data && <>
        {data.rolesError && <ErrorBanner message={data.rolesError} onRetry={load} />}
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs uppercase tracking-wider text-stone/55">WDL linked role</span>
            <select className="input !w-64" value={roleId} disabled={busy} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">Disabled</option>
              {data.roleId && !data.roles.some((r) => r.id === data.roleId) && <option value={data.roleId}>Unavailable role ({data.roleId})</option>}
              {data.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <button className="btn-primary" disabled={busy || (!!roleId && !data.roles.some((r) => r.id === roleId))} onClick={() => void run(true)}>{busy ? "Working…" : "Save and assign"}</button>
          <button className="btn-ghost" disabled={busy || !data.roleId || roleId !== data.roleId} onClick={() => void run(false)}>Sync now</button>
        </div>
        <p className="text-xs text-stone/50">The bot needs Manage Roles, and its highest role must be above the selected role. Only assignable roles are listed.</p>
        <div className="card p-3 text-sm">
          <p>{data.roleId ? "Automatic assignment enabled." : "Automatic assignment disabled."}</p>
          <p className="mt-1 text-stone/60">Last check: {data.lastSyncedAt ? new Date(data.lastSyncedAt).toLocaleString("en-GB") : "Not run yet"}{data.lastSyncedAt ? ` · ${data.lastAdded} role(s) assigned` : ""}</p>
        </div>
        {data.lastError && <ErrorBanner message={data.lastError} />}
      </>}
      {node}
    </div>
  );
}
