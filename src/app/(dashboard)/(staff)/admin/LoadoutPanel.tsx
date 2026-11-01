"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/client";
import { ErrorBanner, useToast } from "@/components/ui";

interface Channel { id: string; name: string; category: string | null }
interface Table { config: { channelId: string; messageId: string; postedAt: string } | null }

export default function LoadoutPanel() {
  const api = useApi();
  const { toast, node } = useToast();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [posted, setPosted] = useState<Table["config"]>(null);
  const [channelId, setChannelId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadChannels = useCallback(async (refresh: boolean) => {
    try {
      setChannels((await api<{ channels: Channel[] }>(`/api/channels${refresh ? "?refresh=1" : ""}`)).channels);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);

  useEffect(() => {
    void loadChannels(true);
    api<Table>("/api/loadout").then((t) => {
      setPosted(t.config);
      if (t.config) setChannelId(t.config.channelId);
    }, () => undefined);
  }, [api, loadChannels]);

  async function post() {
    setBusy(true);
    try {
      await api("/api/loadout/post", { method: "POST", body: { channelId } });
      setPosted({ channelId, messageId: "", postedAt: new Date().toISOString() });
      toast({ text: posted ? "Tracker reposted" : "Tracker posted", tone: "ok" });
    } catch (e) {
      toast({ text: (e as Error).message, tone: "err" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 p-4">
      <h2 className="text-lg font-semibold">Loadout unlock tracker</h2>
      <p className="text-sm text-stone/60">Choose where the unlock-tracker embed is posted. Only channels the bot can view, send and embed in are listed. Posting again replaces the previous embed.</p>
      {error && <ErrorBanner message={error} onRetry={() => void loadChannels(true)} />}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-stone/60">Channel</span>
          <select className="input !w-72" value={channelId} onChange={(e) => setChannelId(e.target.value)} disabled={busy}>
            <option value="">Choose a channel…</option>
            {channels.map((c) => <option key={c.id} value={c.id}>#{c.name}{c.category ? ` (${c.category})` : ""}</option>)}
          </select>
        </label>
        <button className="btn-ghost" disabled={busy} onClick={() => void loadChannels(true)}>Refresh channels</button>
        <button className="btn-primary" disabled={busy || !channelId} onClick={() => void post()}>{posted ? "Repost embed" : "Post embed"}</button>
      </div>
      {node}
    </div>
  );
}
