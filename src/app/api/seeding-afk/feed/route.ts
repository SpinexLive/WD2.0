import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { receiveSeedingFeed, seedingFeedSchema } from "@/server/services/seedingAfk";

export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  const secret = env().SEEDING_AFK_FEED_TOKEN;
  const actual = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return new NextResponse("Unauthorized", { status: 401 });
  // Bound the stream, including chunked requests without Content-Length.
  const reader = req.body?.getReader();
  if (!reader) return new NextResponse("Missing body", { status: 400 });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 256_000) { await reader.cancel(); return new NextResponse("Too large", { status: 413 }); }
    chunks.push(value);
  }
  let body;
  try { body = seedingFeedSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
  catch { return new NextResponse("Invalid event feed", { status: 400 }); }
  try { await receiveSeedingFeed(body); return NextResponse.json({ ok: true }); }
  catch (e) { console.error("seeding feed failed:", (e as Error).message); return new NextResponse("Feed unavailable", { status: 503 }); }
}
