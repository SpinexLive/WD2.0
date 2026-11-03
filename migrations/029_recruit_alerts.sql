CREATE TABLE recruit_alert_state (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  initialized_at timestamptz,
  last_scan_at timestamptz,
  last_error text
);
INSERT INTO recruit_alert_state (id) VALUES (1);

CREATE TABLE recruit_alerts (
  steam_id text PRIMARY KEY CHECK (steam_id ~ '^[0-9]{17}$'),
  candidate jsonb NOT NULL,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  post_status text NOT NULL CHECK (post_status IN ('baseline', 'pending', 'posting', 'posted', 'unknown')),
  post_error text,
  post_started_at timestamptz,
  discord_message_id text,
  invite_status text NOT NULL DEFAULT 'ready' CHECK (invite_status IN ('ready', 'sending', 'sent', 'unknown')),
  invite_started_at timestamptz,
  invited_at timestamptz,
  invited_by text,
  invite_error text
);
