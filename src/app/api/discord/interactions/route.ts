import { NextResponse, type NextRequest } from "next/server";
import { handleRosterButton, verifyDiscordSignature, type ButtonInteraction } from "@/server/services/rosterResponses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Discord's Interactions Endpoint. Authenticated by request signature rather than a dashboard session. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyDiscordSignature(raw, req.headers.get("x-signature-ed25519"), req.headers.get("x-signature-timestamp"))) {
    return new NextResponse("invalid request signature", { status: 401 });
  }
  let body: { type?: number } & Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }
  if (body.type === 1) return NextResponse.json({ type: 1 });
  if (body.type === 3) {
    try {
      return NextResponse.json(await handleRosterButton(body as ButtonInteraction));
    } catch (err) {
      console.error("roster button failed:", err instanceof Error ? err.message : "unknown");
      return NextResponse.json({ type: 4, data: { content: "Something went wrong. Please try again.", flags: 64 } });
    }
  }
  return new NextResponse("unsupported interaction", { status: 400 });
}
