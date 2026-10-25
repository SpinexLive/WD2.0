"use client";

import { createContext, useCallback, useContext, useMemo } from "react";

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
