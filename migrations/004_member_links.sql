CREATE TABLE IF NOT EXISTS member_links (
  discord_id text PRIMARY KEY,
  steam_id text NOT NULL UNIQUE,
  linked_by text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now()
);
