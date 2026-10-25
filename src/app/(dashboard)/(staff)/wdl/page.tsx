"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/client";
import { Avatar, ConfirmDialog, ErrorBanner, Icon, Skeleton, WarnBanner, useToast } from "@/components/ui";

interface Source { fetchedAt: string | null; stale: boolean; error: string | null; available?: boolean }
interface Application { id: string; discordId: string | null; name: string | null; displayName: string | null; avatarUrl: string | null }
interface LeagueOnly { discordId: string; name: string | null; role: string | null; joinedAt: string | null }
interface Data {
  leagueOnly: LeagueOnly[] | null;
  applications: Application[] | null;
  sources: { leagueMembers: Source; leagueApplications: Source };
}

export default function WardogsLeaguePage() {
  const api = useApi();
  const { toast, node } = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<{ app: Application; accept: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      try {
        setData(await api<Data>(`/api/members${refresh ? "?refresh=1" : ""}`));
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [api],
  );
  useEffect(() => void load(), [load]);

  async function respond() {
    if (!confirm) return;
    setBusy(true);
    try {
      const r = await api<{ outcome: string; refreshed: boolean }>(`/api/applications/${encodeURIComponent(confirm.app.id)}/respond`, { method: "POST", body: { accept: confirm.accept } });
      toast({ text: `Application ${r.outcome}.${r.refreshed ? "" : " Data refresh failed – press Refresh."}`, tone: "ok" });
      setConfirm(null);
      await load();
    } catch (e) {
      toast({ text: (e as Error).message, tone: "err" });
      setConfirm(null);
      await load(true);
    } finally {
      setBusy(false);
    }
  }

  const s = data?.sources;
  const unavailable = s && (!s.leagueMembers.available || s.leagueMembers.stale || !s.leagueApplications.available || s.leagueApplications.stale);

  return (
    <div className="flex flex-col gap-4 md:h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Wardogs League</h1>
        <button className="btn-ghost" disabled={loading} onClick={() => load(true)}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => load()} />}
      {unavailable && <WarnBanner>Wardogs League data is unavailable or outdated, so the lists below may be missing rather than empty.</WarnBanner>}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        <section className="card flex max-h-[70vh] min-h-64 flex-col md:max-h-none">
          <h2 className="card-head shrink-0">Pending tournament applications</h2>
          <div className="min-h-0 flex-1 overflow-auto">
            {loading && !data ? (
              <div className="space-y-2 p-4"><Skeleton /><Skeleton /></div>
            ) : data?.applications == null ? (
              <p className="p-4 text-sm text-stone/60">Applications could not be loaded, so none are shown.</p>
            ) : data.applications.length === 0 ? (
              <p className="p-4 text-sm text-stone/60">No pending applications.</p>
            ) : (
              <ul className="divide-y divide-ink-700">
                {data.applications.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar src={a.avatarUrl} />
                      <div>
                        <div className="text-sm font-medium">{a.displayName ?? "Unknown applicant"}</div>
                        <div className="text-xs text-stone/60">{a.discordId ?? "No Discord ID supplied"}</div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn-primary" onClick={() => setConfirm({ app: a, accept: true })}><Icon name="accept" size={14} />Accept</button>
                      <button className="btn-ghost" onClick={() => setConfirm({ app: a, accept: false })}><Icon name="decline" size={14} />Reject</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section id="league-only" className="card flex max-h-[70vh] min-h-64 scroll-mt-4 flex-col md:max-h-none">
          <div className="shrink-0 border-b border-ink-700 px-4 py-3">
            <h2 className="flex items-center gap-2 font-semibold uppercase tracking-[0.12em] before:h-3.5 before:w-1 before:rounded-sm before:bg-blood-600">Registered with WDL but not in Remnant</h2>
            <p className="mt-1 text-xs text-stone/60">Wardogs League members whose Discord ID does not have the clan member role. The Wardogs League API has no endpoint to remove members, so removal must be done on wardogsleague.net.</p>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {loading && !data ? (
              <div className="space-y-2 p-4"><Skeleton /><Skeleton /></div>
            ) : data?.leagueOnly == null ? (
              <p className="p-4 text-sm text-stone/60">Wardogs League members are unavailable or outdated, so this comparison is not shown.</p>
            ) : data.leagueOnly.length === 0 ? (
              <p className="p-4 text-sm text-stone/60">Every Wardogs League member is in the clan member list.</p>
            ) : (
              <table className="w-full min-w-[420px]">
                <thead className="sticky top-0 z-10 bg-ink-850"><tr className="border-b border-ink-700"><th className="th">Player</th><th className="th">Discord ID</th><th className="th">Role</th><th className="th">Joined</th></tr></thead>
                <tbody>
                  {data.leagueOnly.map((l) => (
                    <tr key={l.discordId} className="border-b border-ink-800">
                      <td className="px-3 py-1.5 text-sm">{l.name ?? "Unknown"}</td>
                      <td className="px-3 py-1.5 text-xs text-stone/60">{l.discordId}</td>
                      <td className="px-3 py-1.5 text-sm">{l.role ?? "-"}</td>
                      <td className="px-3 py-1.5 text-xs text-stone/60">{l.joinedAt ? new Date(l.joinedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      {confirm && (
        <ConfirmDialog title={confirm.accept ? "Accept application?" : "Reject application?"} confirmLabel={confirm.accept ? "Accept" : "Reject"} busy={busy} onConfirm={respond} onCancel={() => setConfirm(null)}>
          {confirm.accept ? "Accept" : "Reject"} the Wardogs League application from <strong>{confirm.app.displayName ?? confirm.app.discordId ?? confirm.app.id}</strong>? This is sent to Wardogs League immediately and is recorded in the audit log.
        </ConfirmDialog>
      )}
      {node}
    </div>
  );
}
