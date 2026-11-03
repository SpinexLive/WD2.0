"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog, ErrorBanner, Skeleton, useToast } from "@/components/ui";
import { useApi, type ApiError } from "@/lib/client";
import type { RecruitTestPlayers } from "@/server/services/recruitTest";

export default function RecruitTestPanel() {
  const api = useApi();
  const { toast, node } = useToast();
  const [players, setPlayers] = useState<RecruitTestPlayers["players"] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const selected = players?.find((player) => player.steamId === selectedId);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<RecruitTestPlayers>("/api/admin/recruit-test");
      setPlayers(result.players);
      setSelectedId((id) => result.players.some((player) => player.steamId === id && !player.unavailable) ? id : "");
      setError(null);
    } catch (e) {
      setPlayers(null);
      setSelectedId("");
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  async function send() {
    if (!selected?.previewDigest) return;
    setSending(true);
    try {
      const result = await api<{ playerName: string; countedAsInvitation: boolean; discordSyncError: string | null }>("/api/admin/recruit-test", {
        method: "POST",
        body: { steamId: selected.steamId, previewDigest: selected.previewDigest, requestId: crypto.randomUUID() },
      });
      setConfirm(false);
      toast({ text: result.discordSyncError ?? `Test sent to ${result.playerName}.${result.countedAsInvitation ? " They are marked contacted." : ""}`, tone: result.discordSyncError ? "err" : "ok" });
      await load();
    } catch (e) {
      const apiError = e as ApiError;
      setConfirm(false);
      setPlayers(null);
      setSelectedId("");
      setError(apiError.status === 0
        ? "Could not confirm whether the test was sent. Check with the player and refresh before retrying."
        : apiError.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-lg font-semibold">Recruitment message test</h2>
      <p className="text-sm text-stone/60">Send the actual recruitment invitation to a player currently on the game server. Choose a willing test recipient: the message does not say it is a test. It uses their real stored match count, K/D and average cash.</p>
      <p className="text-sm text-stone/60">If the player is a recruit, sending this counts as their one invitation and marks them contacted. Other players are not added to the Recruit page. The message may say their stats compare well even if they are not a suitable recruit.</p>
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-stone/60">Connected player</span>
          <select className="input !w-80 max-w-full" value={selectedId} disabled={loading || sending || !players} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">Select a player</option>
            {players?.map((player) => (
              <option key={player.steamId} value={player.steamId} disabled={!!player.unavailable}>
                {player.name || "Unknown"} · {player.steamId}{player.unavailable ? ` — ${player.unavailable}` : ""}
              </option>
            ))}
          </select>
        </label>
        <button className="btn-ghost" disabled={loading || sending} onClick={() => void load()}>Refresh players</button>
        <button className="btn-primary" disabled={loading || sending || !selected?.message || !!selected.unavailable} onClick={() => setConfirm(true)}>Send test</button>
      </div>
      {loading && !players && <Skeleton className="h-10 w-full" />}
      {players && players.length === 0 && <p className="text-sm text-stone/60">No players are currently connected.</p>}
      {selected?.message && selected.stats && (
        <div className="card space-y-2 p-3 text-sm">
          <p className="font-semibold">Message preview for {selected.name}</p>
          <p className="text-xs text-stone/60">{selected.stats.matches} qualifying match(es) · {selected.stats.kd.toFixed(2)} K/D · {selected.stats.avgCash.toLocaleString("en-GB")} average cash</p>
          <p className="whitespace-pre-wrap break-words text-stone/80">{selected.message}</p>
        </div>
      )}
      {confirm && selected?.message && (
        <ConfirmDialog title="Send a real in-game message?" confirmLabel="Send test" busy={sending} onConfirm={() => void send()} onCancel={() => setConfirm(false)}>
          <p>This will send the message below to <strong>{selected.name}</strong> ({selected.steamId}). {selected.willCount ? "It counts as their one recruitment invitation and marks them contacted." : "They are not currently a recruit, so their recruit status will not change."}</p>
          <p className="mt-3 whitespace-pre-wrap break-words">{selected.message}</p>
        </ConfirmDialog>
      )}
      {node}
    </div>
  );
}
