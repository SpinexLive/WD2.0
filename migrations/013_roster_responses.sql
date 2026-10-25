-- Players confirm or decline their roster spot from the Discord embed buttons.
CREATE TABLE roster_responses (
  roster_id uuid NOT NULL REFERENCES rosters (id) ON DELETE CASCADE,
  discord_id text NOT NULL,
  response text NOT NULL CHECK (response IN ('accepted', 'declined')),
  responded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (roster_id, discord_id)
);

-- Everyone assigned is always mentioned now; the setting no longer exists.
UPDATE rosters SET settings = settings - 'mentionPlayers';
