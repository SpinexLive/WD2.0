ALTER TABLE scouting_events
  ADD COLUMN IF NOT EXISTS prompt_channel_id text,
  ADD COLUMN IF NOT EXISTS prompt_message_id text;
