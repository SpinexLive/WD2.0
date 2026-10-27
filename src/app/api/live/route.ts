import { getSession } from "@/lib/session";
import { subscribe } from "@/server/services/bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Server-sent events: tells open pages that voice or roster data changed so they can refetch. Carries no sensitive payload. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          cleanup();
        }
      };
      const unsub = subscribe((e) => send(`event: ${e.topic}\ndata: ${JSON.stringify(e.data)}\n\n`));
      const beat = setInterval(() => send(`: ping\n\n`), 25_000);
      cleanup = () => {
        clearInterval(beat);
        unsub();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", cleanup);
      send(`retry: 5000\n\n: connected\n\n`);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
