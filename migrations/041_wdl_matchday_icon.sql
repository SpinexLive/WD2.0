CREATE TABLE wdl_matchday_icon_state (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  current_icon text CHECK (current_icon IN ('matchday', 'default')),
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO wdl_matchday_icon_state (id) VALUES (1);
