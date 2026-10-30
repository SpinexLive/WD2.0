import { z } from "zod";
import { protectedRoute } from "@/lib/apiGuard";
import { HttpError } from "@/lib/http";
import { deleteNews, newsSchema, updateNews } from "@/server/services/news";

export const dynamic = "force-dynamic";

const idOf = (id: string) => {
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(400, "Invalid news id", "invalid_input");
  return id;
};

export const PUT = protectedRoute<{ id: string }>(async ({ req, session, params }) => ({ post: await updateNews(session, idOf(params.id), newsSchema.parse(await req.json())) }), { newsOnly: true });

export const DELETE = protectedRoute<{ id: string }>(async ({ session, params }) => {
  await deleteNews(session, idOf(params.id));
  return { ok: true };
}, { newsOnly: true });
