CREATE TABLE wdl_role_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  role_id text,
  last_synced_at timestamptz,
  last_added integer NOT NULL DEFAULT 0,
  last_error text
);
INSERT INTO wdl_role_settings (id) VALUES (true);
