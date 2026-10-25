import { query } from "./db";

/** Fixed-window limiter stored in Postgres so it holds across instances. Returns seconds to wait, or 0 when allowed. */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const window = now - (now % windowSec);
  const [row] = await query<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count`,
    [key, window],
  );
  if (Math.random() < 0.01) await query("DELETE FROM rate_limits WHERE window_start < $1", [now - 3600]);
  return (row?.count ?? 1) > limit ? window + windowSec - now : 0;
}

const inflight = new Set<string>();

/** Rejects a second concurrent execution for the same key (duplicate submission guard). */
export async function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T | "busy"> {
  if (inflight.has(key)) return "busy";
  inflight.add(key);
  try {
    return await fn();
  } finally {
    inflight.delete(key);
  }
}
