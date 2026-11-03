ALTER TABLE recruit_alerts
  ADD COLUMN embed_revision integer NOT NULL DEFAULT 1,
  ADD COLUMN embed_synced_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN embed_retry_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN embed_error text;
