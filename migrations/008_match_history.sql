-- Match history pulled from the Wardogs API (GET /matches and GET /matches/{id}). The API only exposes the latest 100 matches,
-- so rows are kept here and history grows over time.
CREATE TABLE IF NOT EXISTS matches (
  id            BIGINT PRIMARY KEY,
  server_name   TEXT,
  map           TEXT,
  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  duration_s    INTEGER,
  peak_players  INTEGER,
  mvp_steam_id  TEXT,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS match_players (
  match_id  BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  steam_id  TEXT   NOT NULL,
  name      TEXT,
  faction   TEXT,
  kills     INTEGER NOT NULL DEFAULT 0,
  deaths    INTEGER NOT NULL DEFAULT 0,
  cash      BIGINT,
  PRIMARY KEY (match_id, steam_id)
);

CREATE INDEX IF NOT EXISTS match_players_steam_idx ON match_players (steam_id);
CREATE INDEX IF NOT EXISTS matches_ended_idx ON matches (ended_at DESC);
