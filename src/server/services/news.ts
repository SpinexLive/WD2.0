import { z } from "zod";
import { query } from "@/lib/db";
import { audit } from "@/lib/audit";
import { HttpError } from "@/lib/http";
import type { Session } from "@/lib/session";

export interface NewsPost {
  id: string;
  title: string;
  body: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

export const newsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
});

interface Row {
  id: string;
  title: string;
  body: string;
  author_name: string;
  created_at: Date;
  updated_at: Date;
}

const toPost = (r: Row): NewsPost => ({ id: r.id, title: r.title, body: r.body, authorName: r.author_name, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() });

export async function listNews(limit = 50): Promise<NewsPost[]> {
  const rows = await query<Row>("SELECT id, title, body, author_name, created_at, updated_at FROM news_posts ORDER BY created_at DESC LIMIT $1", [limit]);
  return rows.map(toPost);
}

export async function createNews(session: Session, input: z.infer<typeof newsSchema>): Promise<NewsPost> {
  const [row] = await query<Row>(
    "INSERT INTO news_posts (title, body, author_id, author_name) VALUES ($1,$2,$3,$4) RETURNING id, title, body, author_name, created_at, updated_at",
    [input.title, input.body, session.discordId, session.displayName],
  );
  await audit(session, "news.created", "news", row!.id, { title: input.title });
  return toPost(row!);
}

export async function updateNews(session: Session, id: string, input: z.infer<typeof newsSchema>): Promise<NewsPost> {
  const [row] = await query<Row>(
    "UPDATE news_posts SET title = $2, body = $3, updated_at = now() WHERE id = $1 RETURNING id, title, body, author_name, created_at, updated_at",
    [id, input.title, input.body],
  );
  if (!row) throw new HttpError(404, "News post not found", "not_found");
  await audit(session, "news.updated", "news", id, { title: input.title });
  return toPost(row);
}

export async function deleteNews(session: Session, id: string): Promise<void> {
  const rows = await query<{ title: string }>("DELETE FROM news_posts WHERE id = $1 RETURNING title", [id]);
  if (!rows[0]) throw new HttpError(404, "News post not found", "not_found");
  await audit(session, "news.deleted", "news", id, { title: rows[0].title });
}
