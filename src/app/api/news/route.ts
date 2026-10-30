import { protectedRoute } from "@/lib/apiGuard";
import { createNews, listNews, newsSchema } from "@/server/services/news";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async () => ({ posts: await listNews() }), { newsOnly: true });

export const POST = protectedRoute(async ({ req, session }) => ({ post: await createNews(session, newsSchema.parse(await req.json())) }), { newsOnly: true });
