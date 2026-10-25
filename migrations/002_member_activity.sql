-- Last in-game sighting per Discord member, plus the matches already scanned so each one is read only once.
CREATE TABLE IF NOT EXISTS member_activity (
  discord_id   text PRIMARY KEY,
  steam_id     text,
  last_seen_at timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS processed_matches (
  match_id     bigint PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
