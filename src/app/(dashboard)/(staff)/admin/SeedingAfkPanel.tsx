"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/client";
import { ErrorBanner } from "@/components/ui";
import type { SeedingSettings } from "@/lib/seedingAfk";

interface Status {
  settings: SeedingSettings;
  runtime: { reason?: string; lastError?: string; lastPollAt?: string; count?: number; terminated?: boolean };
  registrations: { discord_id: string; displayName: string; steam_id: string; registered_at: string; next_switch_at: string }[];
  rconConfigured: boolean;
}
interface OnlinePlayer { steamId: string; name: string; faction: string; discordId: string | null; displayName: string }
export default function SeedingAfkPanel() {
  const api = useApi();
  const [status, setStatus] = useState<Status | null>(null);
  const [settings, setSettings] = useState<SeedingSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [players, setPlayers] = useState<OnlinePlayer[]>([]);
  const [selectedSteamId, setSelectedSteamId] = useState("");
  const load = useCallback(async () => {
    try {
      const data = await api<Status>("/api/admin/seeding-afk");
      setStatus(data); setSettings((old) => old ?? data.settings); setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [api]);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 15_000); return () => clearInterval(timer); }, [load]);
  async function save(publish = false) {
    setBusy(true); setNotice("");
    try {
      let data = await api<Status>("/api/admin/seeding-afk", { method: "PUT", body: settings });
      if (publish) data = await api<Status>("/api/admin/seeding-afk", { method: "POST" });
      setStatus(data); setSettings(data.settings); setError(null);
      setNotice(publish ? "Settings saved and registration embed published." : "Settings saved. Existing registrations preserved unless protection was disabled or the threshold was reached.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function refreshPlayers() {
    setBusy(true);
    try {
      const result = await api<{ players: OnlinePlayer[] }>("/api/admin/seeding-afk/players");
      setPlayers(result.players); setSelectedSteamId(""); setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function managePlayer(discordId?: string) {
    setBusy(true); setNotice("");
    try {
      const result = await api<Status>("/api/admin/seeding-afk/players", discordId
        ? { method: "DELETE", body: { discordId } }
        : { method: "POST", body: { steamId: selectedSteamId } });
      setStatus(result); setError(null);
      setNotice(discordId ? "Player removed. Reminders and team switching stopped." : "Player registered as Seeding AFK.");
      setSelectedSteamId("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4 p-4">
    <p className="text-sm text-stone/60">Players can opt in using their linked Discord account, or be registered here by an administrator. Seeding is determined by the server player count being below the configured threshold. Reaching the threshold stops it for the entire session, even if the population drops again.</p>
    {error && <ErrorBanner message={error} onRetry={load} />}
    {settings && status && <>
      {!status.rconConfigured && <ErrorBanner message="Setup required: configure GAME_RCON_URL and GAME_RCON_PASSWORD in the dashboard environment, then restart it." />}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.enabled} onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })} />Enable Seeding AFK protection</label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">Player threshold<input className="input mt-1" type="number" min={2} max={1000} value={settings.threshold} onChange={(e) => setSettings({ ...settings, threshold: Number(e.target.value) })} /></label>
        <label className="text-sm">Switch interval (seconds)<input className="input mt-1" type="number" min={30} max={3600} value={settings.intervalSeconds} onChange={(e) => setSettings({ ...settings, intervalSeconds: Number(e.target.value) })} /></label>
        <label className="text-sm">Discord channel ID<input className="input mt-1" value={settings.channelId ?? ""} onChange={(e) => setSettings({ ...settings, channelId: e.target.value || null, messageId: null })} /></label>
        <label className="text-sm">Existing bot message ID (optional)<input className="input mt-1" value={settings.messageId ?? ""} onChange={(e) => setSettings({ ...settings, messageId: e.target.value || null })} /></label>
        <label className="text-sm md:col-span-2">Embed title<input className="input mt-1" maxLength={256} value={settings.title} onChange={(e) => setSettings({ ...settings, title: e.target.value })} /></label>
        <label className="text-sm md:col-span-2">Embed description<textarea className="input mt-1" maxLength={3000} value={settings.description} onChange={(e) => setSettings({ ...settings, description: e.target.value })} /></label>
      </div>
      <p className="text-xs text-stone/60">Account linking is required. Settings updates preserve registrations. Each switch prefers the smallest other team; team balance does not block attempts. The game server can still reject a move.</p>
      <div className="flex gap-2"><button className="btn-primary" disabled={busy} onClick={() => void save()}>Save settings</button><button className="btn-ghost" disabled={busy || !settings.channelId} onClick={() => void save(true)}>Save and publish embed</button></div>
      {notice && <p role="status" className="text-sm">{notice}</p>}
      <div className="card p-3 text-sm"><p>{status.runtime.reason ?? "Waiting for server player count"} · {status.runtime.count ?? "?"} players</p><p className="text-stone/60">Last poll: {status.runtime.lastPollAt ? new Date(status.runtime.lastPollAt).toLocaleString("en-GB") : "Not yet"}</p></div>
      {status.runtime.lastError && <ErrorBanner message={status.runtime.lastError} />}
      <div className="card space-y-3 p-3">
        <p className="text-sm font-semibold">Manually register a player</p>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost" disabled={busy} onClick={() => void refreshPlayers()}>Load connected players</button>
          <select className="input !w-auto" aria-label="Player to register" value={selectedSteamId} disabled={busy} onChange={(e) => setSelectedSteamId(e.target.value)}>
            <option value="">Select a connected player</option>
            {players.map((p) => <option key={p.steamId} value={p.steamId} disabled={!p.discordId || status.registrations.some((r) => r.steam_id === p.steamId)}>{p.displayName} · {p.faction}{!p.discordId ? " (link Discord first)" : status.registrations.some((r) => r.steam_id === p.steamId) ? " (registered)" : ""}</option>)}
          </select>
          <button className="btn-primary" disabled={busy || !selectedSteamId || !status.settings.enabled || status.runtime.terminated} onClick={() => void managePlayer()}>Add Seeding AFK</button>
        </div>
        <p className="text-xs text-stone/60">Manual registration uses the player's linked account so they can click I'm back in Discord to stop it. Other registrations are preserved.</p>
      </div>
      <p className="text-sm">Registered players: {status.registrations.length}</p>
      <div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th className="th">Discord nickname</th><th className="th">Steam ID</th><th className="th">Next check</th><th className="th">Manage</th></tr></thead><tbody>{status.registrations.map((p) => <tr key={p.discord_id}><td className="p-2" title={p.discord_id}>{p.displayName}</td><td className="p-2">{p.steam_id}</td><td className="p-2">{new Date(p.next_switch_at).toLocaleString("en-GB")}</td><td className="p-2"><button className="btn-ghost" disabled={busy} onClick={() => void managePlayer(p.discord_id)}>Remove</button></td></tr>)}</tbody></table></div>
      <p className="text-xs text-stone/60">Registration, return, disconnect, switch, threshold and termination events appear in the Admin audit log.</p>
    </>}
  </div>;
}
