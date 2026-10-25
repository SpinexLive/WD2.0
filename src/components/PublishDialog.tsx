"use client";

import { useEffect, useState } from "react";
import { useApi, type ApiError } from "@/lib/client";
import { Badge, ConfirmDialog, ErrorBanner, Icon, Skeleton, WarnBanner } from "./ui";
import type { PublishedMessage, RosterWarning } from "@/lib/rosterTypes";

interface Embed { title?: string; description?: string; color: number; fields: { name: string; value: string }[]; footer?: { text: string } }
interface Preview {
  version: number;
  embeds: Embed[];
  names: Record<string, string>;
  warnings: RosterWarning[];
  messages: PublishedMessage[];
  destination: { id: string; name: string | null } | null;
}

const STATUS_ICON_NAME = { yes: "accept", no: "decline", pending: "pending" } as const;

/** Renders the status emoji as the dashboard's own icons. */
function Rich({ text, names }: { text: string; names: Record<string, string> }) {
  return (
    <>
      {text.split(/(<:(?:yes|no|pending):\d+>)/).map((part, i) => {
        const m = /^<:(yes|no|pending):\d+>$/.exec(part);
        return m ? <Icon key={i} name={STATUS_ICON_NAME[m[1] as keyof typeof STATUS_ICON_NAME]} size={14} className="mr-0.5 align-text-bottom" /> : <span key={i}>{readable(part, names)}</span>;
      })}
    </>
  );
}

/** Approximates Discord's rendering closely enough to review the content; Discord renders the real timestamps. */
const readable = (s: string, names: Record<string, string>) =>
  s
    .replace(/<@(\d+)>/g, (_, id: string) => `@${names[id] ?? "player"}`)
    .replace(/<t:(\d+):([a-zA-Z])>/g, (_, t: string, f: string) => {
      const d = new Date(Number(t) * 1000);
      return f === "D" ? d.toLocaleDateString() : f === "t" ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "(relative time)";
    })
    .replace(/\*\*/g, "")
    .replace(/\\([\\*_~`|>[\]()#])/g, "$1");

export function PublishDialog({ eventId, onClose, onDone }: { eventId: string; onClose: () => void; onDone: (msg: string) => void }) {
  const api = useApi();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"publish" | "update" | "republish">("publish");
  const [step, setStep] = useState<"preview" | "confirm">("preview");
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    api<Preview>(`/api/rosters/${encodeURIComponent(eventId)}/preview`)
      .then((p) => {
        setPreview(p);
        const first = p.messages[0];
        setMode(first ? "update" : "publish");
      })
      .catch((e: Error) => setError(e.message));
  }, [api, eventId]);

  const published = (preview?.messages.length ?? 0) > 0;
  const blockers = preview?.warnings.filter((w) => w.severity === "error") ?? [];
  const canContinue = !!preview && blockers.length === 0 && !!preview.destination && (mode !== "update" || published);

  async function submit() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ action: string }>(`/api/rosters/${encodeURIComponent(eventId)}/publish`, {
        method: "POST",
        body: { mode, version: preview.version },
      });
      onDone(`Roster ${r.action} on Discord.`);
    } catch (e) {
      const err = e as ApiError;
      setStep("preview");
      setMissing(err.code === "message_missing");
      if (err.code === "message_missing") setMode("republish");
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (step === "confirm") {
    const where = `#${preview?.destination?.name ?? preview?.destination?.id}`;
    return (
      <ConfirmDialog
        title={mode === "update" ? "Update Discord roster?" : mode === "republish" ? "Republish roster?" : "Publish to Discord?"}
        confirmLabel={mode === "update" ? "Update" : "Publish"}
        busy={busy}
        onConfirm={submit}
        onCancel={() => setStep("preview")}
      >
        This will {mode === "update" ? "edit" : "post"} the roster in <strong>{where}</strong>. No @everyone, @here or user pings are sent.
        {preview && preview.warnings.length > 0 && <p className="mt-2 text-warn">{preview.warnings.length} warning(s) remain; the roster is still incomplete or inconsistent.</p>}
      </ConfirmDialog>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label="Publish to Discord">
      <div className="card flex max-h-[92vh] w-full max-w-3xl flex-col">
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
          <h2 className="text-lg font-bold uppercase tracking-[0.12em]">Publish to Discord</h2>
          <button className="btn-ghost !py-1" onClick={onClose}>Close</button>
        </div>
        <div className="space-y-4 overflow-y-auto p-5">
          {error && <ErrorBanner message={error} />}
          {missing && <WarnBanner>A previously published message was deleted. Select “Republish” to post it again.</WarnBanner>}
          {!preview && !error && <Skeleton className="h-40" />}
          {preview && (
            <>
              {published && (
                <div className="flex flex-wrap gap-2 text-sm">
                  {(["update", "republish"] as const).map((m) => (
                    <button key={m} className={mode === m ? "btn-primary" : "btn-ghost"} onClick={() => setMode(m)}>{m === "update" ? "Update existing Discord roster" : "Republish as new message"}</button>
                  ))}
                </div>
              )}
              <p className="text-sm text-stone/75">{mode === "update" ? `Updates the existing message${preview.messages.length > 1 ? "s" : ""} in place; no new post is created unless the roster grows beyond the existing parts.` : "Posts in the Raid Helper event channel, where players signed up."} Destination: <strong>{preview.destination ? `#${preview.destination.name ?? preview.destination.id}` : "unknown"}</strong></p>
              {preview.warnings.length > 0 && (
                <div className="rounded-md border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
                  <div className="mb-1 font-medium">Validation ({preview.warnings.length})</div>
                  <ul className="list-disc space-y-0.5 pl-5">{preview.warnings.slice(0, 15).map((w, i) => <li key={i}>{w.severity === "error" ? "Error: " : ""}{w.message}</li>)}</ul>
                  {preview.warnings.length > 15 && <div className="mt-1">…and {preview.warnings.length - 15} more</div>}
                </div>
              )}
              <div className="space-y-3">
                <div className="text-sm font-medium text-stone/75">Message preview {preview.embeds.length > 1 && <Badge tone="grey">{preview.embeds.length} messages</Badge>}</div>
                {preview.embeds.map((e, i) => (
                  <div key={i} className="rounded-md bg-ink-800 p-4" style={{ borderLeft: `4px solid #${e.color.toString(16).padStart(6, "0")}` }}>
                    {e.title && <div className="font-semibold">{e.title}</div>}
                    {e.description && <div className="mt-1 whitespace-pre-wrap text-sm text-stone/75">{readable(e.description, preview.names)}</div>}
                    <div className="mt-3 space-y-2">
                      {e.fields.map((f, j) => (
                        <div key={j}><div className="text-sm font-semibold">{f.name}</div><div className="whitespace-pre-wrap text-sm text-stone/75"><Rich text={f.value} names={preview.names} /></div></div>
                      ))}
                    </div>
                    {e.footer && <div className="mt-3 text-xs text-stone/40">{e.footer.text}</div>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-ink-700 px-5 py-3">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!canContinue} onClick={() => setStep("confirm")}>Continue</button>
        </div>
      </div>
    </div>
  );
}
