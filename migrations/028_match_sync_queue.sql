CREATE TABLE match_sync_queue (
  id              BIGINT PRIMARY KEY,
  server_name     TEXT,
  map             TEXT,
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ NOT NULL,
  duration_s      INTEGER,
  peak_players    INTEGER,
  mvp_steam_id    TEXT,
  queued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT
);

CREATE INDEX match_sync_queue_retry_idx ON match_sync_queue (next_attempt_at, ended_at, id);
