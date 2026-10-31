import { after, NextResponse, type NextRequest } from "next/server";
import { verifyDiscordSignature } from "@/server/services/rosterResponses";
import { BUTTON_PREFIX } from "@/server/services/rosterPublish";
import { finishRosterInteraction, type DeferredRosterInteraction } from "@/server/services/rosterInteractions";
import { FEEDBACK_BUTTON, FEEDBACK_MODAL, handleFeedbackRaw } from "@/server/services/scoutingDiscord";
import { SEEDING_BUTTON, seedingButton } from "@/server/services/seedingAfk";
import { requestJson } from "@/lib/http";

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
  const customId = (body.data as { custom_id?: string } | undefined)?.custom_id ?? "";
  if (body.type === 3 && customId.startsWith(`${SEEDING_BUTTON}:`)) {
    if (typeof body.application_id !== "string" || !/^\d+$/.test(body.application_id) || typeof body.token !== "string" || !/^[\w.-]+$/.test(body.token)) return new NextResponse("invalid interaction credentials", { status: 400 });
    const applicationId = body.application_id;
    const token = body.token;
    after(async () => {
      let content = "Seeding protection could not be updated. Please try again.";
      try {
        const member = body.member as { user?: { id?: string } } | undefined;
        if (member?.user?.id) content = await seedingButton({ guildId: body.guild_id as string, channelId: body.channel_id as string,
          messageId: (body.message as { id?: string } | undefined)?.id, userId: member.user.id, customId });
      } catch (e) { console.error("seeding interaction failed:", (e as Error).message); }
      await requestJson({ provider: "discord", method: "PATCH", url: `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`,
        body: { content, allowed_mentions: { parse: [] } }, retries: 0 }).catch(() => console.error("seeding interaction reply failed"));
    });
    return NextResponse.json({ type: 5, data: { flags: 64 } });
  }
  if ((body.type === 3 && customId.startsWith(`${FEEDBACK_BUTTON}:`)) || (body.type === 5 && customId.startsWith(`${FEEDBACK_MODAL}:`))) {
    try {
      return NextResponse.json(await handleFeedbackRaw(body));
    } catch (err) {
      console.error("feedback interaction failed:", err instanceof Error ? err.message : "unknown");
      return NextResponse.json({ type: 4, data: { content: "Something went wrong. Please try again.", flags: 64 } });
    }
  }
  if (body.type === 3 && customId.startsWith(`${BUTTON_PREFIX}:`)) {
    if (typeof body.application_id !== "string" || !/^\d+$/.test(body.application_id) || typeof body.token !== "string" || !/^[\w.-]+$/.test(body.token)) {
      return new NextResponse("invalid interaction credentials", { status: 400 });
    }
    after(() => finishRosterInteraction(body as unknown as DeferredRosterInteraction));
    return NextResponse.json({ type: 6 });
  }
  return new NextResponse("unsupported interaction", { status: 400 });
}
