CREATE TABLE gwl_fixture_archive (
  match_number text PRIMARY KEY,
  fixture jsonb NOT NULL,
  is_result boolean NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
