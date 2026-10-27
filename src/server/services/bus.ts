export type LiveTopic = "voice" | "roster";
export interface LiveEvent {
  topic: LiveTopic;
  data: Record<string, unknown>;
}

type Listener = (e: LiveEvent) => void;
const g = globalThis as unknown as { __bus?: Set<Listener> };
const listeners = (): Set<Listener> => (g.__bus ??= new Set());

/** In-process fan-out to the open /api/live streams. The app runs as a single container, so no external broker is needed. */
export function publish(topic: LiveTopic, data: Record<string, unknown> = {}): void {
  for (const l of listeners()) {
    try {
      l({ topic, data });
    } catch {
      // A broken stream must not stop the others.
    }
  }
}

export function subscribe(l: Listener): () => void {
  listeners().add(l);
  return () => void listeners().delete(l);
}

export const subscriberCount = () => listeners().size;
