"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/client";
import { ConfirmDialog, ErrorBanner, Skeleton, useToast } from "@/components/ui";
import type { WdlRaidStatus } from "@/server/services/wdlRaid";

type Confirmation = "enable" | "disable" | { link: string } | { scheduled: string } | { retry: string } | { remove: string };

export default function WdlFixturesPanel() {
  const api = useApi();
  const { toast, node } = useToast();
  const [data, setData] = useState<WdlRaidStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [eventIds, setEventIds] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setData(await api<WdlRaidStatus>("/api/admin/wdl-fixtures"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  async function run(body: object) {
    setBusy(true);
    try {
      setData(await api<WdlRaidStatus>("/api/admin/wdl-fixtures", { method: "POST", body }));
      setConfirm(null);
      setError(null);
      toast({ text: "WDL fixture settings updated.", tone: "ok" });
    } catch (e) {
      setConfirm(null);
      const message = (e as Error).message;
      await load();
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  const confirmBody = confirm === "enable" ? { action: "enable" }
    : confirm === "disable" ? { action: "disable" }
      : confirm && "link" in confirm ? { action: "link", fixtureId: confirm.link, eventId: eventIds[confirm.link] }
        : confirm && "scheduled" in confirm ? { action: "link-scheduled", fixtureId: confirm.scheduled, scheduledId: eventIds[confirm.scheduled] }
          : confirm && "retry" in confirm ? { action: "retry", fixtureId: confirm.retry }
            : confirm && "remove" in confirm ? { action: "delete", fixtureId: confirm.remove } : null;

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-lg font-semibold">WDL fixture automation</h2>
      <p className="text-sm text-stone/60">Newly observed WDL fixtures create a `ct34` Raid Helper event. Existing fixtures are baselined on first activation. A previously hidden older fixture may be treated as new, as agreed.</p>
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {!data && !error && <Skeleton className="h-24" />}
      {data && (
        <>
          <div className="rounded border border-ink-700 p-3 text-sm">
            <p>Automation: <strong>{data.enabled ? "On" : data.activationPending ? "Waiting for a fresh WDL baseline" : "Off"}</strong></p>
            {data.lastError && <p className="text-red-400">Worker: {data.lastError}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {!data.enabled && !data.activationPending && <button className="btn-primary" disabled={busy} onClick={() => setConfirm("enable")}>Enable automation</button>}
            {(data.enabled || data.activationPending) && <button className="btn-ghost" disabled={busy} onClick={() => setConfirm("disable")}>Disable automation</button>}
            <button className="btn-ghost" disabled={busy} onClick={() => void load()}>Refresh</button>
          </div>
          {data.events.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold">Fixture event status</h3>
              {data.events.map((event) => (
                <div key={event.fixtureId} className="rounded border border-ink-700 p-3 text-sm">
                  <p><strong>Fixture {event.fixture.number ?? event.fixtureId}</strong> · {event.state}</p>
                  {event.error && <p className="text-red-400">{event.error}</p>}
                  {event.eventId && event.eventChannelId && <p><a className="text-blood-300 hover:underline" target="_blank" rel="noopener noreferrer" href={`https://discord.com/channels/1332320879073296404/${encodeURIComponent(event.eventChannelId)}/${encodeURIComponent(event.eventId)}`}>Open Raid Helper event</a></p>}
                  {event.scheduledId && <p>Scheduled event: {event.scheduledId}</p>}
                  {event.state === "review" && event.scheduledId && !event.eventId && <p className="text-xs text-stone/60">Review the scheduled event in Raid Helper; deleting scheduled events here has not been verified.</p>}
                  {["review", "uncertain", "creating"].includes(event.state) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input className="input !w-64" aria-label={`Existing event ID for fixture ${event.fixtureId}`} placeholder="Existing Raid Helper event ID" value={eventIds[event.fixtureId] ?? ""} onChange={(e) => setEventIds({ ...eventIds, [event.fixtureId]: e.target.value })} />
                      <button className="btn-ghost" disabled={busy || !(eventIds[event.fixtureId] ?? "").trim()} onClick={() => setConfirm({ link: event.fixtureId })}>Link existing event</button>
                      <button className="btn-ghost" disabled={busy || !(eventIds[event.fixtureId] ?? "").trim()} onClick={() => setConfirm({ scheduled: event.fixtureId })}>Link scheduled event</button>
                      {!event.eventId && !event.scheduledId && <button className="btn-ghost" disabled={busy} onClick={() => setConfirm({ retry: event.fixtureId })}>Retry creation</button>}
                      {event.state === "review" && event.eventId && <button className="btn-ghost" disabled={busy} onClick={() => setConfirm({ remove: event.fixtureId })}>Delete linked event</button>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {confirm && confirmBody && (
        <ConfirmDialog title={confirm === "enable" ? "Enable WDL automation?" : confirm === "disable" ? "Disable WDL automation?" : typeof confirm === "object" && "remove" in confirm ? "Delete the Raid Helper event?" : typeof confirm === "object" && "retry" in confirm ? "Retry event creation?" : "Link this event?"}
          confirmLabel={confirm === "enable" ? "Enable automation" : confirm === "disable" ? "Disable" : typeof confirm === "object" && "remove" in confirm ? "Delete event" : typeof confirm === "object" && "retry" in confirm ? "Retry creation" : "Link event"}
          danger={typeof confirm === "object" && "remove" in confirm} busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void run(confirmBody)}>
          {confirm === "enable" ? data?.baselineAt ? "The original baseline will be retained; newly observed fixtures may be processed after re-enabling." : "Current WDL fixtures will be baselined and newly observed fixtures will create Raid Helper events."
            : confirm === "disable" ? "No new creation attempts will start. A request already in progress may still complete. Existing Raid Helper events remain in place."
              : typeof confirm === "object" && "remove" in confirm ? "This permanently deletes the linked Raid Helper event and may remove its sign-ups. The dashboard roster is not deleted. Check the fixture before continuing."
                : typeof confirm === "object" && "retry" in confirm ? "Check Raid Helper for an existing posted or scheduled event first. Retrying an uncertain request can create a duplicate if Raid Helper has not listed the earlier event yet."
                  : "Confirm that the chosen Raid Helper event has the current WDL teams, map and time, and the correct member role and briefing voice channel. Update it in Raid Helper first if needed. The dashboard will link it rather than create a duplicate."}
        </ConfirmDialog>
      )}
      {node}
    </div>
  );
}
