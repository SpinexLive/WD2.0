CREATE TABLE wdl_result_posts (
  fixture_id text PRIMARY KEY,
  fixture jsonb NOT NULL,
  published_fixture jsonb,
  state text NOT NULL CHECK (state IN ('pending', 'posting', 'posted', 'updating', 'uncertain', 'review')),
  message_id text UNIQUE,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state NOT IN ('posted', 'updating') OR message_id IS NOT NULL)
);

CREATE TABLE wdl_result_post_status (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_error text,
  last_checked_at timestamptz
);
INSERT INTO wdl_result_post_status (id) VALUES (1);
