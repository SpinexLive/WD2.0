CREATE TABLE recruit_test_attempts (
  request_id uuid PRIMARY KEY,
  steam_id text NOT NULL CHECK (steam_id ~ '^[0-9]{17}$'),
  actor_id text NOT NULL,
  tracked_recruit boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'unknown')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error text
);

CREATE UNIQUE INDEX recruit_test_attempts_active_player_idx
  ON recruit_test_attempts (steam_id) WHERE status IN ('sending', 'unknown');
