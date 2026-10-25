ALTER TABLE processed_matches
  ADD COLUMN IF NOT EXISTS ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS player_count integer,
  ADD COLUMN IF NOT EXISTS matched_count integer;
