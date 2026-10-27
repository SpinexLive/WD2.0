-- Scouting: observations members make about the two opposing teams in a match.
-- Staff open a Raid Helper event for feedback; only players rostered for it may write observations.
CREATE TABLE scouting_events (
  event_id text PRIMARY KEY,
  title text NOT NULL,
  starts_at timestamptz,
  team_a text NOT NULL,
  team_b text NOT NULL,
  opened_by text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

-- One observation per author per team per event (editable). The author is kept for integrity but never shown to reviewers.
CREATE TABLE scouting_observations (
  id bigserial PRIMARY KEY,
  event_id text NOT NULL REFERENCES scouting_events (event_id) ON DELETE CASCADE,
  team_key text NOT NULL,
  team_name text NOT NULL,
  author_id text NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, team_key, author_id)
);
CREATE INDEX scouting_obs_team_idx ON scouting_observations (team_key, created_at DESC);

-- Cached AI overview per opposing team; regenerated on request when new feedback has arrived.
CREATE TABLE scouting_summaries (
  team_key text PRIMARY KEY,
  team_name text NOT NULL,
  summary text NOT NULL,
  obs_count integer NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);
