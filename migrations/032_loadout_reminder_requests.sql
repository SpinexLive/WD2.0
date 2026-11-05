CREATE TABLE loadout_reminder_requests (
  request_id uuid PRIMARY KEY,
  actor_id text NOT NULL,
  recipient_count integer NOT NULL,
  sent_count integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
