CREATE TABLE news_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  author_id text NOT NULL,
  author_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX news_posts_created_idx ON news_posts (created_at DESC);
