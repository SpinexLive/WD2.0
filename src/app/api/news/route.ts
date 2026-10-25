import { protectedRoute } from "@/lib/apiGuard";
import { createNews, listNews, newsSchema } from "@/server/services/news";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async () => ({ posts: await listNews() }));

export const POST = protectedRoute(async ({ req, session }) => ({ post: await createNews(session, newsSchema.parse(await req.json())) }));
