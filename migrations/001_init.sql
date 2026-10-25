CREATE TABLE sessions (
  id text PRIMARY KEY,
  discord_id text NOT NULL,
  username text NOT NULL,
  display_name text NOT NULL,
  avatar_url text NOT NULL,
  roles text[] NOT NULL DEFAULT '{}',
  csrf_token text NOT NULL,
  roles_checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_discord_id_idx ON sessions (discord_id);

CREATE TABLE oauth_states (
  state text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roster_templates (
  id serial PRIMARY KEY,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('competitive', 'weekly')),
  definition jsonb NOT NULL,
  is_builtin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One roster per Raid Helper event. Only the event ID is stored: title, time and sign-ups stay authoritative in Raid Helper.
CREATE TABLE rosters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raid_helper_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL CHECK (event_type IN ('competitive', 'weekly')),
  template_id integer REFERENCES roster_templates (id) ON DELETE SET NULL,
  format text NOT NULL DEFAULT '',
  settings jsonb NOT NULL DEFAULT '{"warnUnregistered": true, "mentionPlayers": false}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  version integer NOT NULL DEFAULT 1,
  last_editor_id text NOT NULL,
  created_by text NOT NULL,
  publishing_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roster_squads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id uuid NOT NULL REFERENCES rosters (id) ON DELETE CASCADE,
  position integer NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  size integer NOT NULL CHECK (size BETWEEN 1 AND 100),
  required boolean NOT NULL DEFAULT true,
  leader_required boolean NOT NULL DEFAULT false
);
CREATE INDEX roster_squads_roster_idx ON roster_squads (roster_id, position);

CREATE TABLE roster_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id uuid NOT NULL REFERENCES rosters (id) ON DELETE CASCADE,
  squad_id uuid NOT NULL REFERENCES roster_squads (id) ON DELETE CASCADE,
  slot_index integer NOT NULL CHECK (slot_index >= 0),
  discord_id text NOT NULL,
  display_name text NOT NULL,
  avatar_url text,
  is_leader boolean NOT NULL DEFAULT false,
  UNIQUE (roster_id, discord_id),
  UNIQUE (squad_id, slot_index)
);

CREATE TABLE published_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id uuid NOT NULL REFERENCES rosters (id) ON DELETE CASCADE,
  part_index integer NOT NULL,
  channel_id text NOT NULL,
  message_id text NOT NULL,
  published_by text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamptz,
  UNIQUE (roster_id, part_index)
);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  actor_id text NOT NULL,
  actor_name text,
  action text NOT NULL,
  target_type text,
  target_id text,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

CREATE TABLE rate_limits (
  key text NOT NULL,
  window_start bigint NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY (key, window_start)
);

INSERT INTO roster_templates (key, name, event_type, is_builtin, definition) VALUES
('competitive-49', 'Competitive Match (49v49)', 'competitive', true, '{
  "format": "49v49 Warfare",
  "squads": [
    {"name":"Commander","category":"COMMAND","size":1,"required":true,"leaderRequired":false},
    {"name":"Squad 1","category":"INFANTRY","size":6,"required":true,"leaderRequired":true},
    {"name":"Squad 2","category":"INFANTRY","size":6,"required":true,"leaderRequired":true},
    {"name":"Squad 3","category":"INFANTRY","size":6,"required":true,"leaderRequired":true},
    {"name":"Squad 4","category":"INFANTRY","size":6,"required":true,"leaderRequired":true},
    {"name":"Squad 5","category":"INFANTRY","size":6,"required":true,"leaderRequired":true},
    {"name":"Squad 6","category":"INFANTRY","size":6,"required":true,"leaderRequired":true},
    {"name":"Armour 1","category":"ARMOUR","size":3,"required":true,"leaderRequired":true},
    {"name":"Armour 2","category":"ARMOUR","size":3,"required":true,"leaderRequired":true},
    {"name":"Recon","category":"RECON","size":4,"required":true,"leaderRequired":true},
    {"name":"Anti Air","category":"ANTI AIR","size":2,"required":false,"leaderRequired":false},
    {"name":"FOB","category":"FOB","size":2,"required":false,"leaderRequired":false},
    {"name":"Reserves","category":"RESERVES","size":8,"required":false,"leaderRequired":false}
  ]}'),
('weekly-flex', 'Weekly Event (flexible)', 'weekly', true, '{
  "format": "",
  "squads": [
    {"name":"Commander","category":"COMMAND","size":1,"required":false,"leaderRequired":false},
    {"name":"Squad 1","category":"INFANTRY","size":6,"required":false,"leaderRequired":true},
    {"name":"Squad 2","category":"INFANTRY","size":6,"required":false,"leaderRequired":true},
    {"name":"Squad 3","category":"INFANTRY","size":6,"required":false,"leaderRequired":true},
    {"name":"Reserves","category":"RESERVES","size":10,"required":false,"leaderRequired":false}
  ]}');
