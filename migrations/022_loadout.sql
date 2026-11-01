CREATE TABLE loadout_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  channel_id text NOT NULL,
  message_id text NOT NULL,
  posted_by text NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE loadout_unlocks (
  discord_id text NOT NULL,
  item_key text NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (discord_id, item_key)
);
CREATE INDEX loadout_unlocks_item_idx ON loadout_unlocks (item_key);
