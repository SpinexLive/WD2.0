"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/client";
import { ConfirmDialog, ErrorBanner, Skeleton, useToast } from "@/components/ui";
import type { WdlRaidStatus } from "@/server/services/wdlRaid";

type Confirmation = "test" | "approve" | "disable" | "recover-test" | "clear-test" | { link: string } | { scheduled: string } | { retry: string } | { remove: string };

export default function WdlFixturesPanel() {
  const api = useApi();
  const { toast, node } = useToast();
  const [data, setData] = useState<WdlRaidStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [eventIds, setEventIds] = useState<Record<string, string>>({});
  const [testScheduleId, setTestScheduleId] = useState("");

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

  const confirmBody = confirm === "test" ? { action: "test" }
    : confirm === "approve" ? { action: "approve", testId: data?.test?.id }
      : confirm === "disable" ? { action: "disable" }
        : confirm === "recover-test" ? { action: "recover-test", testId: data?.test?.id, scheduledId: testScheduleId }
        : confirm === "clear-test" ? { action: "clear-test", testId: data?.test?.id }
        : confirm && "link" in confirm ? { action: "link", fixtureId: confirm.link, eventId: eventIds[confirm.link] }
          : confirm && "scheduled" in confirm ? { action: "link-scheduled", fixtureId: confirm.scheduled, scheduledId: eventIds[confirm.scheduled] }
            : confirm && "retry" in confirm ? { action: "retry", fixtureId: confirm.retry }
          : confirm && "remove" in confirm ? { action: "delete", fixtureId: confirm.remove } : null;

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-lg font-semibold">WDL fixture automation</h2>
      <p className="text-sm text-stone/60">Newly observed WDL fixtures create a `ct34` Raid Helper event. Existing fixtures are baselined when you approve the test. A previously hidden older fixture may be treated as new, as agreed.</p>
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {!data && !error && <Skeleton className="h-24" />}
      {data && (
        <>
          <div className="rounded border border-ink-700 p-3 text-sm">
            <p>Automation: <strong>{data.enabled ? "On" : "Off"}</strong></p>
            <p className="text-stone/60">Test: {data.test ? `${data.test.state} · ${data.test.title}` : "Not run"}</p>
            {data.test?.eventId && <a className="text-blood-300 hover:underline" target="_blank" rel="noopener noreferrer" href={`https://discord.com/channels/1332320879073296404/1546184970706616412/${encodeURIComponent(data.test.eventId)}`}>Open posted test event</a>}
            {data.test?.error && <p className="text-red-400">{data.test.error}</p>}
            {data.lastError && <p className="text-red-400">Worker: {data.lastError}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy || data.enabled || !!data.test && ["creating", "scheduled", "uncertain"].includes(data.test.state)} onClick={() => setConfirm("test")}>Create test event</button>
            <button className="btn-ghost" disabled={busy || !data.test || data.test.state !== "scheduled"} onClick={() => void run({ action: "check" })}>Check test</button>
            <button className="btn-ghost" disabled={busy || data.enabled || data.test?.state !== "posted"} onClick={() => setConfirm("approve")}>Confirm test and enable</button>
            {data.enabled && <button className="btn-ghost" disabled={busy} onClick={() => setConfirm("disable")}>Disable automation</button>}
            <button className="btn-ghost" disabled={busy} onClick={() => void load()}>Refresh</button>
          </div>
          <p className="text-xs text-stone/60">The test posts in channel 1546184970706616412 after approximately three minutes, with briefing 30 minutes later. It pings the real member role, uses a test-only temporary role name and disables the attendee reminder. The dashboard does not delete the test artifacts; Raid Helper may later clean up the temporary role according to its existing setting.</p>
          {data.test && ["creating", "uncertain"].includes(data.test.state) && (
            <div className="flex flex-wrap gap-2">
              <input className="input !w-64" aria-label="Scheduled test ID" placeholder="Scheduled test ID" value={testScheduleId} onChange={(e) => setTestScheduleId(e.target.value)} />
              <button className="btn-ghost" disabled={busy || !testScheduleId.trim()} onClick={() => setConfirm("recover-test")}>Recover test</button>
              <button className="btn-ghost" disabled={busy} onClick={() => setConfirm("clear-test")}>Clear after checking</button>
              <span className="text-xs text-stone/60">Check Raid Helper for the scheduled test ID before recovering; do not create another test blindly.</span>
            </div>
          )}
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
        <ConfirmDialog title={confirm === "test" ? "Create a real test event?" : confirm === "approve" ? "Enable WDL automation?" : confirm === "disable" ? "Disable WDL automation?" : typeof confirm === "object" && "remove" in confirm ? "Delete the Raid Helper event?" : "Link this event?"}
          confirmLabel={confirm === "test" ? "Create test" : confirm === "approve" ? "Enable automation" : confirm === "disable" ? "Disable" : confirm === "recover-test" ? "Recover test" : confirm === "clear-test" ? "Clear test" : typeof confirm === "object" && "remove" in confirm ? "Delete event" : typeof confirm === "object" && "retry" in confirm ? "Retry creation" : "Link event"}
          danger={typeof confirm === "object" && "remove" in confirm} busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void run(confirmBody)}>
          {confirm === "test" ? "This schedules a real, clearly labelled test in the test channel and mentions the real Wardogs member role. Members who can see that channel may receive a notification."
            : confirm === "approve" ? `Confirm that you inspected the posted test: template and times are correct, the role ping worked, signup access is restricted, and the temporary role is assigned. Live role cleanup remains unverified, as agreed. ${data?.baselineAt ? "The original baseline will be retained; newly observed fixtures may be processed after re-enabling." : "Current WDL fixtures will be baselined and future newly observed fixtures will be created automatically."}`
              : confirm === "disable" ? "No new creation attempts will start. A request already in progress may still complete. Existing Raid Helper events remain in place."
                : confirm === "recover-test" ? "Confirm that this is the scheduled test ID from Raid Helper. The dashboard will verify its channel, title and start time."
                  : confirm === "clear-test" ? "Check Raid Helper for the test first. Clearing an uncertain test permits another real test and another member-role ping if the first event was created but not yet listed."
                  : typeof confirm === "object" && "remove" in confirm ? "This permanently deletes the linked Raid Helper event and may remove its sign-ups. The dashboard roster is not deleted. Check the fixture before continuing."
                    : typeof confirm === "object" && "retry" in confirm ? "Check Raid Helper for an existing posted or scheduled event first. Retrying an uncertain request can create a duplicate if Raid Helper has not listed the earlier event yet."
                  : "Confirm that the chosen Raid Helper event has the current WDL teams, map and time, and the correct member role and briefing voice channel. Update it in Raid Helper first if needed. The dashboard will link it rather than create a duplicate."}
        </ConfirmDialog>
      )}
      {node}
    </div>
  );
}
