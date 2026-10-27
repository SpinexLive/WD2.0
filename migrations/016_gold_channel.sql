-- The single voice channel whose name shows the daily gold bar price.
CREATE TABLE gold_channel (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  channel_id text NOT NULL,
  category_id text,
  last_price bigint,
  last_price_date date,
  last_checked_at timestamptz,
  last_error text,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
