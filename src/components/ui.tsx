"use client";

import { useEffect, useRef, useState } from "react";

export const Skeleton = ({ className = "h-4 w-full" }: { className?: string }) => <div className={`animate-pulse rounded bg-ink-700 ${className}`} />;

export const ICONS = {
  wardogs: "wardogs.png",
  leader: "squad leader.png",
  recon: "recon.png",
  pilot: "pilot.png",
  pending: "pending.png",
  infantry: "infantry.png",
  fob: "FOB.png",
  driver: "driver.png",
  decline: "decline.png",
  artillery: "artillery.png",
  armour: "armour.png",
  accept: "accept.png",
  aa: "AAGun.png",
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16, className = "" }: { name: IconName; size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/images/icons/${encodeURIComponent(ICONS[name])}`} alt="" width={size} height={size} className={`inline-block shrink-0 object-contain ${className}`} style={{ width: size, height: size }} />;
}

/** Icon for a squad category; unknown categories (e.g. FLEX) fall back to the Wardogs mark. */
export function categoryIcon(category: string): IconName {
  const c = category.toUpperCase();
  if (c.includes("RECON")) return "recon";
  if (c.includes("PILOT")) return "pilot";
  if (c.includes("FOB")) return "fob";
  if (c.includes("ANTI") || /\bAA\b/.test(c)) return "aa";
  if (c.includes("ARMOUR") || c.includes("ARMOR") || c.includes("TANK")) return "armour";
  if (c.includes("DRIVER")) return "driver";
  if (c.includes("ARTILLERY")) return "artillery";
  if (c.includes("HOTZONE") || c.includes("INFANTRY")) return "infantry";
  return "wardogs";
}

export function Avatar({ src, size = 32 }: { src: string | null; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" width={size} height={size} className="rounded-full bg-ink-700" style={{ width: size, height: size }} /> : <div className="rounded-full bg-ink-700" style={{ width: size, height: size }} />;
}

const badgeStyles = {
  green: "bg-ok/15 text-ok border-ok/40",
  amber: "bg-warn/15 text-warn border-warn/40",
  red: "bg-blood-600/20 text-blood-300 border-blood-500/50",
  grey: "bg-ink-700 text-stone/75 border-ink-500",
} as const;

export const Badge = ({ tone, children, title, icon }: { tone: keyof typeof badgeStyles; children: React.ReactNode; title?: string; icon?: IconName }) => (
  <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-px text-[11px] font-medium ${badgeStyles[tone]}`}>
    {icon ? <Icon name={icon} size={12} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
    {children}
  </span>
);

export const REG_LABEL = { registered: "Registered", pending: "Pending", not_registered: "Not Registered", unknown: "Unknown" } as const;
const REG_TONE = { registered: "green", pending: "amber", not_registered: "red", unknown: "grey" } as const;
const REG_ICON = { registered: "accept", pending: "pending", not_registered: "decline", unknown: undefined } as const;
const REG_DOT = { registered: "bg-ok", pending: "bg-warn", not_registered: "bg-blood-500", unknown: "bg-stone/30" } as const;

export const RegBadge = ({ status }: { status: keyof typeof REG_LABEL }) => (
  <Badge tone={REG_TONE[status]} icon={REG_ICON[status]} title={status === "unknown" ? "Wardogs League data unavailable or unreliable" : undefined}>
    {REG_LABEL[status]}
  </Badge>
);

/** Compact registration indicator: green registered, red not registered, amber pending, grey unknown. */
export const RegDot = ({ status }: { status: keyof typeof REG_LABEL }) => (
  <span role="img" aria-label={REG_LABEL[status]} title={REG_LABEL[status]} className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${REG_DOT[status]}`} />
);

export const ErrorBanner = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-blood-600/70 bg-blood-700/15 p-3 text-sm shadow-sm">
    <span>{message}</span>
    {onRetry && <button className="btn-ghost shrink-0 !py-1" onClick={onRetry}>Retry</button>}
  </div>
);

export const WarnBanner = ({ children }: { children: React.ReactNode }) => (
  <div role="status" className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn">{children}</div>
);

export function SyncInfo({ label, fetchedAt, stale, error }: { label: string; fetchedAt: string | null; stale?: boolean; error?: string | null }) {
  return (
    <span className="text-xs text-stone/60">
      {label}: {fetchedAt ? `synced ${new Date(fetchedAt).toLocaleTimeString()}` : "never synced"}
      {stale && <span className="ml-1 text-warn">(outdated – {error ?? "refresh failed"})</span>}
      {!fetchedAt && error && <span className="ml-1 text-blood-300">({error})</span>}
    </span>
  );
}

export function ConfirmDialog(props: {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && !props.busy && props.onCancel();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/75 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label={props.title}>
      <div className="card max-h-[90vh] w-full max-w-lg overflow-y-auto border-t-2 border-t-blood-500 p-5 shadow-2xl shadow-black/70">
        <h2 className="text-lg font-bold uppercase tracking-[0.12em]">{props.title}</h2>
        <div className="mt-3 text-sm text-stone/75">{props.children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={props.onCancel} disabled={props.busy}>Cancel</button>
          <button ref={ref} className={props.danger ? "btn-primary" : "btn-primary"} onClick={props.onConfirm} disabled={props.busy}>
            {props.busy ? "Working…" : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 6000);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg && (
    <div role="status" className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-md border p-3 text-sm shadow-lg ${msg.tone === "ok" ? "border-ok/50 bg-ink-800" : "border-blood-500 bg-ink-800"}`}>{msg.text}</div>
  );
  return { toast: setMsg, node };
}
