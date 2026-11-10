CREATE TABLE gwl_raid_events (
  match_number text PRIMARY KEY,
  fixture jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'waiting', 'creating', 'scheduled', 'posted', 'review', 'uncertain')),
  scheduled_id text UNIQUE,
  event_id text UNIQUE,
  start_time bigint,
  post_at bigint,
  temporary_role text,
  member_role_name text,
  voice_channel_name text,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE gwl_raid_status (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_error text,
  last_checked_at timestamptz
);
INSERT INTO gwl_raid_status (id) VALUES (1);
