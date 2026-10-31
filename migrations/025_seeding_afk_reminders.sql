ALTER TABLE seeding_afk_players
  ADD COLUMN next_reminder_at timestamptz NOT NULL DEFAULT now();
