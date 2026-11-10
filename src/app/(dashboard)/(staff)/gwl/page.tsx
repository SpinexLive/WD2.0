"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/client";
import { ConfirmDialog, ErrorBanner, Skeleton, WarnBanner, useToast } from "@/components/ui";
import type { getGwlApplications, getGwlElo, getGwlFixtures, getGwlMembers, getGwlSlots, getGwlTeam } from "@/server/services/gwl";
import type { GwlRaidStatus } from "@/server/services/gwlRaid";
import { gwlMapLabel } from "@/lib/gwl";

interface Data {
  team: Awaited<ReturnType<typeof getGwlTeam>>;
  members: Awaited<ReturnType<typeof getGwlMembers>>;
  applications: Awaited<ReturnType<typeof getGwlApplications>>;
  fixtures: Awaited<ReturnType<typeof getGwlFixtures>>;
  elo: Awaited<ReturnType<typeof getGwlElo>>;
  slots: Awaited<ReturnType<typeof getGwlSlots>>;
  archivedResults: Fixture[];
  raid: GwlRaidStatus;
}

type Application = Data["applications"]["data"]["applications"][number];
type Fixture = Data["fixtures"]["data"]["upcoming"][number];
const date = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-GB");
};

function Fixtures({ title, fixtures, raid }: { title: string; fixtures: Fixture[]; raid?: GwlRaidStatus }) {
  return (
    <section className="card p-4">
      <h2 className="font-bold">{title}</h2>
      {fixtures.length === 0 ? <p className="mt-2 text-sm text-stone/55">None returned by GWL.</p> : (
        <ul className="mt-2 divide-y divide-ink-700">
          {fixtures.map((fixture) => (
            <li className="py-2 text-sm" key={fixture.number}>
              <div className="font-semibold">{fixture.sides.map((side) => side.team.tag || side.team.name || side.team.slug).join(" v ") || "Teams TBC"}</div>
              <div className="text-stone/60">#{fixture.number} · {date(fixture.startsAt)} · {gwlMapLabel(fixture.map)}{fixture.layer ? ` · ${fixture.layer}` : ""} · {fixture.status}</div>
              {raid?.events.filter((event) => event.matchNumber === fixture.number).map((event) => <div key={event.matchNumber} className="text-xs text-stone/60">
                Raid Helper: {event.state}{event.error ? ` — ${event.error}` : ""}{" "}
                {event.eventUrl && <a className="text-blood-300 hover:underline" href={event.eventUrl} target="_blank" rel="noopener noreferrer">Open signup →</a>}
              </div>)}
              {fixture.sides.some((side) => side.points !== null) && <div className="text-stone/60">{fixture.sides.map((side) => `${side.team.tag || side.team.name || side.team.slug}: ${side.points ?? "?"} points`).join(" · ")}</div>}
              {fixture.serverPosted !== undefined && <div className="text-xs text-stone/50">Server details {fixture.serverPosted ? "posted" : "not posted"} on GWL{fixture.readyTeams?.length ? ` · ${fixture.readyTeams.length} teams ready` : ""}</div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function GwlPage() {
  const api = useApi();
  const { toast, node } = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ application: Application; accept: boolean } | null>(null);
  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      setData(await api<Data>(`/api/gwl${refresh ? "?refresh=1" : ""}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load GWL data.");
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  async function respond() {
    if (!confirm) return;
    setBusy(true);
    try {
      const result = await api<{ outcome: string; refreshed: boolean }>(`/api/gwl/applications/${encodeURIComponent(confirm.application.id)}/respond`, { method: "POST", body: { accept: confirm.accept } });
      toast({ text: `Application ${result.outcome}.${result.refreshed ? "" : " Refresh failed; try again."}`, tone: "ok" });
      setConfirm(null);
      await load();
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "Could not respond to the application.", tone: "err" });
      setConfirm(null);
      await load(true);
    } finally {
      setBusy(false);
    }
  }

  const stale = data && [data.team, data.members, data.applications, data.fixtures, data.elo, data.slots].some((snapshot) => snapshot.stale);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Global Wardogs League</h1>
        <button className="btn-ghost" disabled={loading} onClick={() => void load(true)}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>
      {error && <ErrorBanner message={error} onRetry={() => load(true)} />}
      {stale && <WarnBanner>Some GWL data is outdated. Refresh before relying on it.</WarnBanner>}
      {!data && !error && <Skeleton className="h-40 w-full" />}
      {data && <>
        {data.raid.lastError && <WarnBanner>GWL Raid Helper: {data.raid.lastError}</WarnBanner>}
        {data.raid.events.some((event) => ["review", "uncertain"].includes(event.state)) && <WarnBanner>Some GWL events need manual review in Raid Helper. They will not be automatically recreated.</WarnBanner>}
        {data.raid.events.some((event) => ["review", "uncertain", "waiting"].includes(event.state)) && <section className="card p-4">
          <h2 className="font-bold">Raid Helper issues</h2>
          <ul className="mt-2 space-y-2 text-sm">{data.raid.events.filter((event) => ["review", "uncertain", "waiting"].includes(event.state)).map((event) =>
            <li key={event.matchNumber}>Match #{event.matchNumber}: {event.state}{event.error ? ` — ${event.error}` : ""}{event.scheduledId ? ` · Schedule ID ${event.scheduledId}` : ""}{event.eventId ? ` · Event ID ${event.eventId}` : ""}</li>)}</ul>
        </section>}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="card p-4"><div className="text-xs text-stone/60">Team</div><div className="text-lg font-bold">{data.team.data.name} [{data.team.data.tag}]</div></div>
          <div className="card p-4"><div className="text-xs text-stone/60">Elo</div><div className="text-lg font-bold">{data.elo.data.eloRating.toLocaleString()} <span className="text-xs text-stone/50">({data.elo.data.changeLast5 >= 0 ? "+" : ""}{data.elo.data.changeLast5} last 5)</span></div></div>
          <div className="card p-4"><div className="text-xs text-stone/60">GWL roster</div><div className="text-lg font-bold">{data.team.data.rosterCount} members</div></div>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Fixtures title="Upcoming matches" fixtures={data.fixtures.data.upcoming} raid={data.raid} />
          <Fixtures title="Result history" fixtures={data.archivedResults} />
          <section className="card p-4">
            <h2 className="font-bold">Pending applications</h2>
            {data.applications.data.applications.length === 0 ? <p className="mt-2 text-sm text-stone/55">No pending applications.</p> : (
              <ul className="mt-2 divide-y divide-ink-700">{data.applications.data.applications.map((application) => (
                <li key={application.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <div><div className="font-semibold">{application.name}</div><div className="text-xs text-stone/55">Deadline: {date(application.deadline)}{application.elo != null ? ` · Elo ${application.elo}` : ""}{application.regions?.length ? ` · ${application.regions.join(", ")}` : ""}</div>{application.note && <p className="whitespace-pre-wrap text-sm text-stone/70">{application.note}</p>}</div>
                  <div className="flex gap-2"><button className="btn-primary" onClick={() => setConfirm({ application, accept: true })}>Accept</button><button className="btn-ghost" onClick={() => setConfirm({ application, accept: false })}>Reject</button></div>
                </li>
              ))}</ul>
            )}
          </section>
          <section className="card p-4">
            <h2 className="font-bold">Open slots</h2>
            {data.slots.data.slots.length === 0 ? <p className="mt-2 text-sm text-stone/55">No open slots returned by GWL.</p> : <ul className="mt-2 divide-y divide-ink-700">{data.slots.data.slots.map((slot) => <li className="py-2 text-sm" key={slot.id}>{date(slot.startsAt)} · {gwlMapLabel(slot.map)}{slot.layer ? ` · ${slot.layer}` : ""} · {slot.region} · {slot.seatsFilled} filled</li>)}</ul>}
          </section>
          <section className="card p-4 lg:col-span-2">
            <h2 className="font-bold">Elo history</h2>
            <p className="mt-1 text-xs text-stone/55">Ratings returned by GWL; the API does not provide dates for individual entries.</p>
            {data.elo.data.history.length ? <div className="mt-2 flex flex-wrap gap-2">{data.elo.data.history.map((rating, index) => <span className="rounded border border-ink-700 px-2 py-1 text-sm tabular-nums" key={index}>{rating.toLocaleString()}</span>)}</div> : <p className="mt-2 text-sm text-stone/55">No Elo history returned by GWL.</p>}
          </section>
          <section className="card p-4 lg:col-span-2">
            <h2 className="font-bold">GWL members</h2>
            <p className="mt-1 text-xs text-stone/55">GWL does not supply Discord IDs; these members are not automatically matched to the dashboard.</p>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.members.data.members.map((member, index) => <li className="text-sm" key={`${member.playerId}-${index}`}>{member.name} <span className="text-stone/50">· {member.role}</span></li>)}</ul>
          </section>
        </div>
      </>}
      {confirm && <ConfirmDialog title={confirm.accept ? "Accept GWL application?" : "Reject GWL application?"} confirmLabel={confirm.accept ? "Accept" : "Reject"} busy={busy} onConfirm={respond} onCancel={() => setConfirm(null)}>
        {confirm.accept ? "Accept" : "Reject"} the GWL application from <strong>{confirm.application.name}</strong>? This is sent to GWL and recorded in the audit log.
      </ConfirmDialog>}
      {node}
    </div>
  );
}
