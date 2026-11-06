CREATE TABLE wdl_result_reorder (
  message_id text PRIMARY KEY,
  fixture_id text,
  deleted boolean NOT NULL DEFAULT false,
  completed boolean NOT NULL DEFAULT false
);

INSERT INTO wdl_result_reorder (message_id, fixture_id)
SELECT expected.message_id, posts.fixture_id
FROM (VALUES
  ('1568223527222513665'),
  ('1568223528237535285'),
  ('1568223529500151914'),
  ('1568223531114692610'),
  ('1568223532851142808'),
  ('1568223534256488499')
) AS expected(message_id)
LEFT JOIN wdl_result_posts AS posts ON posts.message_id = expected.message_id
WHERE EXISTS (
  SELECT 1 FROM wdl_result_posts AS existing
  WHERE existing.message_id IN (
    '1568223527222513665', '1568223528237535285', '1568223529500151914',
    '1568223531114692610', '1568223532851142808', '1568223534256488499'
  )
);
