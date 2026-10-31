CREATE TABLE seeding_afk (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  settings jsonb NOT NULL DEFAULT '{"enabled":true,"intervalSeconds":120,"threshold":20,"channelId":null,"messageId":null,"title":"Seeding AFK protection","description":"Register while seeding. Protection ends when the player threshold is reached or the match starts."}',
  runtime jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO seeding_afk (id) VALUES (true);
CREATE TABLE seeding_afk_players (
  discord_id text PRIMARY KEY,
  steam_id text NOT NULL UNIQUE,
  session_id text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  next_switch_at timestamptz NOT NULL
);
