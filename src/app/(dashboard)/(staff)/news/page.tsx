"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/client";
import { ConfirmDialog, ErrorBanner, Skeleton, useToast } from "@/components/ui";
import type { NewsPost } from "@/server/services/news";

export default function NewsPage() {
  const api = useApi();
  const { toast, node } = useToast();
  const [posts, setPosts] = useState<NewsPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<NewsPost | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [remove, setRemove] = useState<NewsPost | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setPosts((await api<{ posts: NewsPost[] }>("/api/news")).posts);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  function open(p: NewsPost | "new") {
    setEditing(p);
    setTitle(p === "new" ? "" : p.title);
    setBody(p === "new" ? "" : p.body);
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      if (editing === "new") await api("/api/news", { method: "POST", body: { title, body } });
      else await api(`/api/news/${editing.id}`, { method: "PUT", body: { title, body } });
      toast({ text: "News saved.", tone: "ok" });
      setEditing(null);
      await load();
    } catch (e) {
      toast({ text: (e as Error).message, tone: "err" });
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!remove) return;
    setBusy(true);
    try {
      await api(`/api/news/${remove.id}`, { method: "DELETE" });
      toast({ text: "News post deleted.", tone: "ok" });
      setRemove(null);
      await load();
    } catch (e) {
      toast({ text: (e as Error).message, tone: "err" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">News</h1>
        <button className="btn-primary" onClick={() => open("new")}>New post</button>
      </div>
      <p className="text-sm text-stone/60">Posts appear on the public landing page (the latest five).</p>
      {error && <ErrorBanner message={error} onRetry={load} />}

      {editing && (
        <div className="card space-y-3 p-4">
          <input className="input" placeholder="Title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
          <textarea className="input min-h-32" placeholder="What's the news?" maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Body" />
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={busy || !title.trim() || !body.trim()}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </div>
      )}

      {!posts && !error && <div className="space-y-2"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>}
      {posts?.length === 0 && <p className="text-sm text-stone/55">No posts yet.</p>}
      <ul className="space-y-3">
        {posts?.map((p) => (
          <li key={p.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-bold text-stone">{p.title}</h2>
                <div className="text-xs text-stone/50">{new Date(p.createdAt).toLocaleString("en-GB")} · {p.authorName}</div>
              </div>
              <div className="flex gap-2">
                <button className="btn-ghost !py-1" onClick={() => open(p)}>Edit</button>
                <button className="btn-ghost !py-1" onClick={() => setRemove(p)}>Delete</button>
              </div>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-stone/75">{p.body}</p>
          </li>
        ))}
      </ul>

      {remove && (
        <ConfirmDialog title="Delete news post" confirmLabel="Delete" danger busy={busy} onConfirm={doDelete} onCancel={() => setRemove(null)}>
          Delete “{remove.title}”? This removes it from the landing page.
        </ConfirmDialog>
      )}
      {node}
    </div>
  );
}
