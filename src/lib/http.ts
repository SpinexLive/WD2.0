export type Provider = "discord" | "wardogs-league" | "raid-helper" | "wardogs-rcon" | "game-rcon";

export class ProviderError extends Error {
  constructor(
    public provider: Provider,
    message: string,
    public status?: number,
    public retryable = false,
    public code?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

interface RequestOptions {
  provider: Provider;
  url: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  headers?: Record<string, string>;
  body?: unknown;
  retries?: number;
  timeoutMs?: number;
  /** Treat these statuses as a normal result instead of an error (e.g. 404 lookups). */
  okStatuses?: number[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * JSON request helper with timeout, Retry-After aware 429 handling and
 * exponential backoff on transient failures. Never logs headers or bodies.
 */
export async function requestJson(opts: RequestOptions): Promise<{ status: number; data: unknown }> {
  const { provider, url, method = "GET", headers = {}, body, retries = method === "GET" ? 3 : 1, timeoutMs = 10_000, okStatuses = [] } = opts;
  let lastError: ProviderError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });

      if (res.status === 204) return { status: 204, data: null };
      const text = await res.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text.slice(0, 200) };
        }
      }

      if (res.ok || okStatuses.includes(res.status)) return { status: res.status, data };

      const message = extractMessage(data) ?? res.statusText;
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") ?? (data as { retry_after?: number })?.retry_after ?? 1);
        lastError = new ProviderError(provider, `Rate limited by ${provider}`, 429, true);
        if (attempt < retries && retryAfter <= 5) {
          await sleep(Math.max(retryAfter, 0.25) * 1000);
          continue;
        }
        throw lastError;
      }
      const retryable = res.status >= 500;
      lastError = new ProviderError(provider, `${provider} returned ${res.status}: ${message}`, res.status, retryable, extractCode(data));
      if (!retryable) throw lastError;
    } catch (err) {
      if (err instanceof ProviderError) {
        lastError = err;
        if (!err.retryable) throw err;
      } else {
        lastError = new ProviderError(provider, `Could not reach ${provider}: ${(err as Error).name === "TimeoutError" ? "request timed out" : "network error"}`, undefined, true);
      }
    }
    if (attempt < retries) await sleep(300 * 2 ** attempt);
  }
  throw lastError ?? new ProviderError(provider, `${provider} request failed`);
}

function extractMessage(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  const nested = d.error && typeof d.error === "object" ? (d.error as Record<string, unknown>).message : undefined;
  const m = nested ?? (typeof d.error === "string" ? d.error : undefined) ?? d.message;
  return typeof m === "string" ? m.slice(0, 200) : undefined;
}

function extractCode(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const c = (data as Record<string, unknown>).code;
  return c === undefined ? undefined : String(c);
}
