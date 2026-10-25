import { z } from "zod";
import { protectedRoute } from "@/lib/apiGuard";
import { audit } from "@/lib/audit";
import { getEventDetail } from "@/server/services/raidHelper";
import { enrichSignups } from "@/server/services/rosterPublish";
import { createRoster, deleteRoster, eventIdSchema, getRoster, listTemplates, saveRoster, saveSchema } from "@/server/services/rosters";

export const dynamic = "force-dynamic";

type P = { eventId: string };

export const GET = protectedRoute<P>(async ({ req, params }) => {
  const eventId = eventIdSchema.parse(params.eventId);
  const force = req.nextUrl.searchParams.get("refresh") === "1";

  const [event, roster, templates] = await Promise.all([
    getEventDetail(eventId, force).then((s) => ({ snap: s, error: null as string | null }), (e: Error) => ({ snap: null, error: e.message })),
    getRoster(eventId),
    listTemplates(),
  ]);
  const enriched = event.snap ? await enrichSignups(event.snap.data.signups, force, true) : null;

  return {
    event: event.snap ? { ...event.snap.data, signups: undefined } : null,
    eventError: event.error,
    eventSource: event.snap ? { fetchedAt: event.snap.fetchedAt, stale: event.snap.stale, error: event.snap.error ?? null } : null,
    // null (not []) when Raid Helper is unreachable, so the UI never reports "no sign-ups" falsely.
    signups: enriched?.signups ?? null,
    leagueAvailable: enriched?.leagueAvailable ?? false,
    roster,
    templates,
  };
});

const createSchema = z.object({ templateKey: z.string().min(1).max(64) }).strict();

export const POST = protectedRoute<P>(async ({ req, session, params }) => {
  const eventId = eventIdSchema.parse(params.eventId);
  const { templateKey } = createSchema.parse(await req.json().catch(() => null));
  const roster = await createRoster(eventId, templateKey, session.discordId);
  await audit(session, "roster.create", "roster", roster.id, { eventId, templateKey });
  return { roster };
});

export const DELETE = protectedRoute<P>(async ({ req, session, params }) => {
  const eventId = eventIdSchema.parse(params.eventId);
  const { version } = z.object({ version: z.number().int().min(1) }).strict().parse(await req.json().catch(() => null));
  const roster = await deleteRoster(eventId, version);
  await audit(session, "roster.delete", "roster", roster.id, { eventId });
  return { deleted: true };
});

export const PUT = protectedRoute<P>(async ({ req, session, params }) => {
  const eventId = eventIdSchema.parse(params.eventId);
  const input = saveSchema.parse(await req.json().catch(() => null));
  const roster = await saveRoster(eventId, input, session.discordId);
  await audit(session, "roster.save", "roster", roster.id, { eventId, version: roster.version });
  return { roster };
});
