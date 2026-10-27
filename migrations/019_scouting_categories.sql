-- Structured match feedback: the original free-text note becomes "overview", with three extra categories.
ALTER TABLE scouting_observations DROP CONSTRAINT IF EXISTS scouting_observations_body_check;
ALTER TABLE scouting_observations
  ADD COLUMN IF NOT EXISTS strengths text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS weaknesses text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tactics text NOT NULL DEFAULT '';
ALTER TABLE scouting_observations
  ADD CONSTRAINT scouting_observations_content_check CHECK (
    char_length(body) <= 2000 AND char_length(strengths) <= 2000 AND char_length(weaknesses) <= 2000 AND char_length(tactics) <= 2000
    AND char_length(body) + char_length(strengths) + char_length(weaknesses) + char_length(tactics) > 0
  );
