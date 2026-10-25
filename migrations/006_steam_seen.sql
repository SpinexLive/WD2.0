CREATE TABLE IF NOT EXISTS steam_seen (
  steam_id text PRIMARY KEY,
  name text,
  last_seen_at timestamptz NOT NULL
);

-- Keep what was already known, then re-read match history once so every player's name and last-seen are recorded by Steam ID.
INSERT INTO steam_seen (steam_id, last_seen_at)
SELECT steam_id, last_seen_at FROM member_activity WHERE steam_id IS NOT NULL
ON CONFLICT (steam_id) DO NOTHING;

DELETE FROM processed_matches;
