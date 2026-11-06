"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/client";
import { ConfirmDialog, ErrorBanner, Skeleton, useToast } from "@/components/ui";
import type { WdlCreatedEventLog, WdlEventDescriptionPreview, WdlRaidStatus } from "@/server/services/wdlRaid";

type Confirmation = "enable" | "disable" | { link: string } | { scheduled: string } | { retry: string } | { remove: string } | { retryResult: string };

export default function WdlFixturesPanel() {
  const api = useApi();
  const { toast, node } = useToast();
  const [data, setData] = useState<WdlRaidStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [eventIds, setEventIds] = useState<Record<string, string>>({});
  const [eventLog, setEventLog] = useState<WdlCreatedEventLog | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logRetryCursor, setLogRetryCursor] = useState<string | null>(null);
  const [preview, setPreview] = useState<WdlEventDescriptionPreview | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<WdlRaidStatus>("/api/admin/wdl-fixtures"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  async function loadEventLog(before: string | null) {
    setLogLoading(true);
    try {
      const page = await api<WdlCreatedEventLog>(`/api/admin/wdl-fixtures/events${before ? `?before=${encodeURIComponent(before)}` : ""}`);
      setEventLog((previous) => before && previous ? { events: [...previous.events, ...page.events], nextCursor: page.nextCursor } : page);
      setLogError(null);
    } catch (e) {
      setLogRetryCursor(before);
      setLogError((e as Error).message);
    } finally {
      setLogLoading(false);
    }
  }

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

  async function previewDescription(fixtureId: string) {
    setBusy(true);
    try {
      const result = await api<WdlEventDescriptionPreview>("/api/admin/wdl-fixtures", { method: "POST", body: { action: "preview-description", fixtureId } });
      setError(null);
      if (result.changed) setPreview(result);
      else toast({ text: "The event description is already up to date.", tone: "ok" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function updateDescription() {
    if (!preview) return;
    setBusy(true);
    try {
      setData(await api<WdlRaidStatus>("/api/admin/wdl-fixtures", { method: "POST", body: {
        action: "update-description", fixtureId: preview.fixtureId, version: preview.version,
      } }));
      setError(null);
      toast({ text: "Event description updated and read back from Raid Helper.", tone: "ok" });
    } catch (e) {
      const message = (e as Error).message;
      await load();
      setError(message);
    } finally {
      setPreview(null);
      setBusy(false);
    }
  }

  const confirmBody = confirm === "enable" ? { action: "enable" }
    : confirm === "disable" ? { action: "disable" }
      : confirm && "link" in confirm ? { action: "link", fixtureId: confirm.link, eventId: eventIds[confirm.link] }
        : confirm && "scheduled" in confirm ? { action: "link-scheduled", fixtureId: confirm.scheduled, scheduledId: eventIds[confirm.scheduled] }
          : confirm && "retry" in confirm ? { action: "retry", fixtureId: confirm.retry }
            : confirm && "remove" in confirm ? { action: "delete", fixtureId: confirm.remove }
              : confirm && "retryResult" in confirm ? { action: "retry-result", fixtureId: confirm.retryResult } : null;

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-lg font-semibold">WDL fixture automation</h2>
      <p className="text-sm text-stone/60">Newly observed WDL fixtures create a `ct34` Raid Helper event. Their IDs are saved for future changes. Existing fixtures are baselined on first activation; a previously hidden older fixture may be treated as new.</p>
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {!data && !error && <Skeleton className="h-24" />}
      {data && (
        <>
          <div className="rounded border border-ink-700 p-3 text-sm">
            <p>Automation: <strong>{data.enabled ? "On" : data.activationPending ? "Waiting for a fresh WDL baseline" : "Off"}</strong></p>
            {data.lastError && <p className="text-red-400">Worker: {data.lastError}</p>}
          </div>
          <div className="rounded border border-ink-700 p-3 text-sm">
            <p><strong>WDL result posts</strong> · <a className="text-blood-300 hover:underline" href="https://discord.com/channels/1332320879073296404/1568220944609316896" target="_blank" rel="noopener noreferrer">Open results channel</a></p>
            <p className="text-xs text-stone/60">Completed results are posted independently of Raid Helper automation. Uncertain posts are not retried automatically: check Discord before taking action.</p>
            {data.results.lastError && <p className="text-red-400">Results worker: {data.results.lastError}</p>}
            {data.results.issues.map((issue) => <div key={issue.fixtureId}>
              <p className={issue.error ? "text-red-400" : "text-stone/60"}>Fixture {issue.fixtureNumber ? `#${issue.fixtureNumber}` : issue.fixtureId}: {issue.state}{issue.error ? ` · ${issue.error}` : ""}{issue.messageId ? ` · Message ${issue.messageId}` : ""}</p>
              {issue.state === "uncertain" && <button className="btn-ghost mt-1" disabled={busy} onClick={() => setConfirm({ retryResult: issue.fixtureId })}>Retry result post</button>}
            </div>)}
          </div>
          <div className="flex flex-wrap gap-2">
            {!data.enabled && !data.activationPending && <button className="btn-primary" disabled={busy} onClick={() => setConfirm("enable")}>Enable automation</button>}
            {(data.enabled || data.activationPending) && <button className="btn-ghost" disabled={busy} onClick={() => setConfirm("disable")}>Disable automation</button>}
            <button className="btn-ghost" disabled={busy || logLoading} onClick={() => { void load(); if (eventLog) void loadEventLog(null); }}>Refresh</button>
          </div>
          {data.events.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold">Fixture event status</h3>
              <p className="text-xs text-stone/60">Description previews are available individually for verified, automatically created posted events with an unchanged upcoming fixture. Scheduled, linked, unverified, past and review-state events are excluded and are not updated automatically.</p>
              {data.events.map((event) => (
                <div key={event.fixtureId} className="rounded border border-ink-700 p-3 text-sm">
                  <p><strong>Fixture {event.fixture.number ?? event.fixtureId}</strong> · {event.state}</p>
                  {event.error && <p className="text-red-400">{event.error}</p>}
                  {event.eventId && <p>Raid Helper event ID: {event.eventId}</p>}
                  {event.eventId && event.eventChannelId && <p><a className="text-blood-300 hover:underline" target="_blank" rel="noopener noreferrer" href={`https://discord.com/channels/1332320879073296404/${encodeURIComponent(event.eventChannelId)}/${encodeURIComponent(event.eventId)}`}>Open Raid Helper event</a></p>}
                  {event.scheduledId && <p>Scheduled event ID: {event.scheduledId}</p>}
                  {event.state === "posted" && event.eventId && <button className="btn-ghost mt-2" disabled={busy} onClick={() => void previewDescription(event.fixtureId)}>Preview description update</button>}
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
          <details className="rounded border border-ink-700 p-3" onToggle={(event) => {
            if (event.currentTarget.open && !eventLog && !logLoading && !logError) void loadEventLog(null);
          }}>
            <summary className="cursor-pointer text-sm font-semibold">Created event ID log</summary>
            <p className="mt-2 text-xs text-stone/60">All recorded IDs are retained. Verified refers to event identity; review the fixture status before any future edits. Older records and unverified IDs need additional review.</p>
            {logError && <ErrorBanner message={logError} onRetry={() => void loadEventLog(logRetryCursor)} />}
            {logLoading && !eventLog && <Skeleton className="mt-2 h-16" />}
            {eventLog && (
              <>
                {eventLog.events.length === 0 && <p className="mt-2 text-sm text-stone/60">No event IDs have been recorded yet.</p>}
                <div className="mt-2 divide-y divide-ink-700">
                  {eventLog.events.map((event) => (
                    <div className="space-y-1 py-2 text-sm" key={event.id}>
                      <p><strong>Fixture {event.fixtureId}</strong> · {event.origin === "automatic" ? "Created by automation" : "Older record: origin unverified"}</p>
                      {event.scheduledId && <p>Scheduled event ID: {event.scheduledId}</p>}
                      {event.eventId && <p>Posted event ID: {event.eventId} · {event.eventVerified ? "verified" : "unverified"}</p>}
                      {event.eventId && event.channelId && /^\d{15,22}$/.test(event.eventId) && /^\d{15,22}$/.test(event.channelId) &&
                        <a className="text-xs text-blood-300 hover:underline" target="_blank" rel="noopener noreferrer" href={`https://discord.com/channels/1332320879073296404/${event.channelId}/${event.eventId}`}>Open event in Discord</a>}
                      <p className="text-xs text-stone/50">Recorded {new Date(event.createdAt).toLocaleString("en-GB")}</p>
                    </div>
                  ))}
                </div>
                {eventLog.nextCursor && <button className="btn-ghost mt-2" disabled={logLoading} onClick={() => void loadEventLog(eventLog.nextCursor)}>Load older IDs</button>}
              </>
            )}
          </details>
        </>
      )}
      {confirm && confirmBody && (
        <ConfirmDialog title={confirm === "enable" ? "Enable WDL automation?" : confirm === "disable" ? "Disable WDL automation?" : typeof confirm === "object" && "remove" in confirm ? "Delete the Raid Helper event?" : typeof confirm === "object" && "retry" in confirm ? "Retry event creation?" : typeof confirm === "object" && "retryResult" in confirm ? "Retry result post?" : "Link this event?"}
          confirmLabel={confirm === "enable" ? "Enable automation" : confirm === "disable" ? "Disable" : typeof confirm === "object" && "remove" in confirm ? "Delete event" : typeof confirm === "object" && "retry" in confirm ? "Retry creation" : typeof confirm === "object" && "retryResult" in confirm ? "Retry result post" : "Link event"}
          danger={typeof confirm === "object" && "remove" in confirm} busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void run(confirmBody)}>
          {confirm === "enable" ? data?.baselineAt ? "The original baseline will be retained; newly observed fixtures may be processed after re-enabling." : "Current WDL fixtures will be baselined and newly observed fixtures will create Raid Helper events."
            : confirm === "disable" ? "No new creation attempts will start. A request already in progress may still complete. Existing Raid Helper events remain in place."
              : typeof confirm === "object" && "remove" in confirm ? "This permanently deletes the linked Raid Helper event and may remove its sign-ups. The dashboard roster is not deleted. Check the fixture before continuing."
                : typeof confirm === "object" && "retry" in confirm ? "Check Raid Helper for an existing posted or scheduled event first. Retrying an uncertain request can create a duplicate if Raid Helper has not listed the earlier event yet."
                  : typeof confirm === "object" && "retryResult" in confirm ? "Check the results channel for this fixture first. If a message was already delivered, remove it before retrying; otherwise a duplicate will be posted. The fixture must still be completed and visible in WDL."
                    : "Confirm that the chosen Raid Helper event has the current WDL teams, map and time, and the correct member role and briefing voice channel. Update it in Raid Helper first if needed. The dashboard will link it rather than create a duplicate."}
        </ConfirmDialog>
      )}
      {preview && (
        <ConfirmDialog title="Update this Raid Helper event?" confirmLabel="Update description" busy={busy} onCancel={() => setPreview(null)} onConfirm={() => void updateDescription()}>
          <p>Fixture {preview.fixtureId} · {preview.title} · Event ID {preview.eventId}</p>
          <p className="mt-2">Only the description is sent. Raid Helper does not explicitly guarantee that signups are preserved by this edit. The dashboard checks signup IDs afterwards, but cannot verify all signup details; check them in Raid Helper. Concurrent signups or cancellations can also require manual review. Staff should avoid editing this event while confirming because Raid Helper does not offer a conditional update.</p>
          <p className="mt-3 font-semibold">Current description</p>
          <pre className="mt-1 whitespace-pre-wrap break-words rounded border border-ink-700 p-2 text-xs">{preview.current}</pre>
          <p className="mt-3 font-semibold">Proposed description</p>
          <pre className="mt-1 whitespace-pre-wrap break-words rounded border border-ink-700 p-2 text-xs">{preview.proposed}</pre>
        </ConfirmDialog>
      )}
      {node}
    </div>
  );
}
