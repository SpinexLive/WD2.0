import { HttpError } from "@/lib/http";
import { protectedRoute } from "@/lib/apiGuard";
import { audit } from "@/lib/audit";
import { deleteObservation } from "@/server/services/scouting";

export const dynamic = "force-dynamic";

/** Staff only: remove an observation. The author is never revealed. */
export const DELETE = protectedRoute<{ id: string }>(async ({ session, params }) => {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "Invalid note id", "invalid_input");
  const r = await deleteObservation(id);
  await audit(session, "scouting.delete_note", "team", r.teamKey, { team: r.teamName, eventId: r.eventId, noteId: id });
  return { ok: true };
});
