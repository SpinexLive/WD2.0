CREATE TABLE IF NOT EXISTS ignored_steam_ids (
  steam_id text PRIMARY KEY,
  ignored_by text NOT NULL,
  ignored_at timestamptz NOT NULL DEFAULT now()
);
