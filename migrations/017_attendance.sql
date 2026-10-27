-- Who was in the briefing voice channel when each rostered event started.
CREATE TABLE attendance_events (
  event_id text PRIMARY KEY,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  rostered integer NOT NULL,
  in_voice integer NOT NULL
);

CREATE TABLE attendance (
  event_id text NOT NULL REFERENCES attendance_events (event_id) ON DELETE CASCADE,
  discord_id text NOT NULL,
  display_name text NOT NULL,
  response text,
  present boolean NOT NULL,
  PRIMARY KEY (event_id, discord_id)
);
CREATE INDEX attendance_discord_idx ON attendance (discord_id);
CREATE INDEX attendance_events_start_idx ON attendance_events (starts_at DESC);
