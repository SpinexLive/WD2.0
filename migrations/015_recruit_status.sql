CREATE TABLE recruit_status (
  steam_id text PRIMARY KEY CHECK (steam_id ~ '^[0-9]{17}$'),
  status text NOT NULL CHECK (status IN ('contacted', 'dismissed')),
  note text,
  updated_by_id text NOT NULL,
  updated_by_name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
