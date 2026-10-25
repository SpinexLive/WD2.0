export interface Snapshot<T> {
  data: T;
  /** ISO timestamp of the last successful fetch from the provider. */
  fetchedAt: string;
  /** True when the provider failed and `data` is the last good copy. */
  stale: boolean;
  error?: string;
}

interface Entry<T> {
  data: T;
  fetchedAt: number;
}

const g = globalThis as unknown as { __cache?: Map<string, Entry<unknown>>; __inflight?: Map<string, Promise<unknown>> };
const store = (g.__cache ??= new Map());
const inflight = (g.__inflight ??= new Map());

/**
 * TTL cache with in-flight de-duplication. If the loader fails, the previous
 * value is returned marked `stale` with the error so callers never present it as current.
 * Throws only when there is no previous value.
 */
export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>, force = false): Promise<Snapshot<T>> {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && !force && Date.now() - hit.fetchedAt < ttlMs) {
    return { data: hit.data, fetchedAt: new Date(hit.fetchedAt).toISOString(), stale: false };
  }

  let pending = inflight.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = loader().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }

  try {
    const data = await pending;
    const entry = { data, fetchedAt: Date.now() };
    store.set(key, entry);
    return { data, fetchedAt: new Date(entry.fetchedAt).toISOString(), stale: false };
  } catch (err) {
    if (hit) {
      return { data: hit.data, fetchedAt: new Date(hit.fetchedAt).toISOString(), stale: true, error: (err as Error).message };
    }
    throw err;
  }
}

export function invalidate(prefix: string): void {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
