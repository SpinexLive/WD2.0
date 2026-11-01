CREATE TABLE server_name_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  base_name text NOT NULL DEFAULT '',
  last_name text,
  last_renamed_at timestamptz,
  last_error text,
  updated_by text
);
INSERT INTO server_name_settings (id) VALUES (1);
