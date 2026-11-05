CREATE TABLE wdl_fixture_archive (
  fixture_id text PRIMARY KEY,
  fixture jsonb NOT NULL,
  is_result boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wdl_raid_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  baseline_at timestamptz,
  test_passed_at timestamptz,
  last_error text
);
INSERT INTO wdl_raid_settings (id) VALUES (1);

CREATE TABLE wdl_fixture_events (
  fixture_id text PRIMARY KEY,
  fixture jsonb NOT NULL,
  baseline boolean NOT NULL DEFAULT false,
  state text NOT NULL CHECK (state IN ('baseline', 'pending', 'waiting', 'creating', 'scheduled', 'posted', 'review', 'uncertain', 'cancelled')),
  scheduled_id text,
  event_id text,
  event_channel_id text,
  post_at bigint,
  start_time bigint,
  temporary_role text,
  member_role_name text,
  voice_channel_name text,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX wdl_fixture_events_active_role ON wdl_fixture_events (lower(temporary_role))
  WHERE temporary_role IS NOT NULL AND state <> 'cancelled';
CREATE UNIQUE INDEX wdl_fixture_events_posted_id ON wdl_fixture_events (event_id)
  WHERE event_id IS NOT NULL AND state <> 'cancelled';
CREATE UNIQUE INDEX wdl_fixture_events_scheduled_id ON wdl_fixture_events (scheduled_id)
  WHERE scheduled_id IS NOT NULL AND state <> 'cancelled';

CREATE TABLE wdl_raid_tests (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  state text NOT NULL CHECK (state IN ('creating', 'scheduled', 'posted', 'uncertain', 'failed')),
  scheduled_id text,
  event_id text,
  post_at bigint,
  start_time bigint,
  error text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX wdl_raid_tests_one_active ON wdl_raid_tests ((true))
  WHERE state IN ('creating', 'scheduled', 'uncertain');
