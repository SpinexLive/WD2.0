CREATE TABLE briefing_voice_channels (
  channel_id text PRIMARY KEY,
  guild_id text NOT NULL,
  event_id text NOT NULL,
  channel_name text NOT NULL,
  squad_names text[] NOT NULL,
  creator_id text NOT NULL,
  creator_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delete_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'deleting', 'deleted')),
  lease_until timestamptz,
  next_attempt_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  deleted_at timestamptz
);

CREATE INDEX briefing_voice_channels_due_idx
  ON briefing_voice_channels (delete_at)
  WHERE status <> 'deleted';
