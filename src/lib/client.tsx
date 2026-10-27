"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";

export interface ApiError extends Error {
  status: number;
  code?: string;
  extra?: Record<string, unknown>;
}

interface AppCtx {
  user: { id: string; displayName: string; username: string; avatarUrl: string };
  csrfToken: string;
}

const Ctx = createContext<AppCtx | null>(null);
export const AppProvider = Ctx.Provider;
export const useApp = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("AppProvider missing");
  return v;
};

export function useApi() {
  const { csrfToken } = useApp();
  const call = useCallback(
    async <T,>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> => {
      const method = opts.method ?? "GET";
      let res: Response;
      try {
        res = await fetch(path, {
          method,
          headers: { ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}) },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          cache: "no-store",
        });
      } catch {
        throw Object.assign(new Error("Network error: could not reach the dashboard server"), { status: 0 }) as ApiError;
      }
      const json = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } & Record<string, unknown> } | null;
      if (res.status === 401) {
        window.location.href = "/login";
      }
      if (!res.ok) {
        const { message, code, ...extra } = json?.error ?? {};
        throw Object.assign(new Error(message ?? `Request failed (${res.status})`), { status: res.status, code, extra }) as ApiError;
      }
      return json as T;
    },
    [csrfToken],
  );
  return useMemo(() => call, [call]);
}

type LiveTopic = "voice" | "roster";
type LiveHandler = (data: { eventId?: string }) => void;
const liveHandlers = new Map<LiveTopic, Set<LiveHandler>>();
let liveSource: EventSource | null = null;

function ensureLive() {
  if (liveSource || typeof EventSource === "undefined") return;
  const es = new EventSource("/api/live");
  for (const topic of ["voice", "roster"] as const) {
    es.addEventListener(topic, (ev) => {
      let data = {};
      try {
        data = JSON.parse((ev as MessageEvent).data);
      } catch {
        // an empty payload is fine
      }
      liveHandlers.get(topic)?.forEach((h) => h(data));
    });
  }
  liveSource = es;
}

/** Calls `cb` when the server reports a change on one of the topics. One shared connection; the browser reconnects on its own. */
export function useLive(topics: LiveTopic[], cb: LiveHandler) {
  const ref = useRef(cb);
  useEffect(() => {
    ref.current = cb;
  });
  const key = topics.join(",");
  useEffect(() => {
    const h: LiveHandler = (d) => ref.current(d);
    const list = key.split(",") as LiveTopic[];
    ensureLive();
    for (const t of list) (liveHandlers.get(t) ?? liveHandlers.set(t, new Set()).get(t)!).add(h);
    return () => {
      for (const t of list) liveHandlers.get(t)?.delete(h);
      if (![...liveHandlers.values()].some((s) => s.size)) {
        liveSource?.close();
        liveSource = null;
      }
    };
  }, [key]);
}