CREATE TABLE wdl_created_events (
  id bigserial PRIMARY KEY,
  fixture_id text NOT NULL,
  channel_id text,
  scheduled_id text,
  event_id text,
  event_verified boolean NOT NULL DEFAULT false,
  origin text NOT NULL CHECK (origin IN ('automatic', 'legacy')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (scheduled_id IS NOT NULL OR event_id IS NOT NULL)
);

CREATE UNIQUE INDEX wdl_created_events_schedule_id ON wdl_created_events (scheduled_id) WHERE scheduled_id IS NOT NULL;
CREATE UNIQUE INDEX wdl_created_events_event_id ON wdl_created_events (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX wdl_created_events_fixture_id ON wdl_created_events (fixture_id);

INSERT INTO wdl_created_events (fixture_id, channel_id, scheduled_id, event_id, event_verified, origin, created_at)
SELECT created.target_id, '1546479425644793877',
       CASE WHEN created.details->>'scheduled' = 'true' THEN created.details->>'raidId' END,
       CASE WHEN created.details->>'scheduled' = 'false' THEN created.details->>'raidId' END,
       false, 'automatic', created.created_at
FROM audit_logs AS created
WHERE created.action = 'wdl.event_created' AND created.target_type = 'wdl_fixture' AND created.target_id IS NOT NULL
  AND created.details->>'raidId' IS NOT NULL AND created.details->>'raidId' <> ''
  AND created.details->>'scheduled' IN ('true', 'false')
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs AS conflicting
    WHERE conflicting.action = 'wdl.event_created' AND conflicting.target_type = 'wdl_fixture'
      AND conflicting.details->>'raidId' = created.details->>'raidId'
      AND conflicting.target_id <> created.target_id
  )
ON CONFLICT DO NOTHING;

UPDATE wdl_created_events AS recorded
SET event_id = fixture.event_id, updated_at = now()
FROM wdl_fixture_events AS fixture
WHERE recorded.origin = 'automatic' AND recorded.scheduled_id = fixture.scheduled_id
  AND recorded.fixture_id = fixture.fixture_id AND fixture.event_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs AS linked
    WHERE linked.action = 'wdl.event_linked' AND linked.target_type = 'wdl_fixture'
      AND linked.target_id = fixture.fixture_id AND linked.created_at >= recorded.created_at
  )
  AND NOT EXISTS (
    SELECT 1 FROM wdl_fixture_events AS other_fixture
    WHERE other_fixture.fixture_id <> fixture.fixture_id AND other_fixture.event_id = fixture.event_id
  )
  AND NOT EXISTS (SELECT 1 FROM wdl_created_events AS other WHERE other.event_id = fixture.event_id);

INSERT INTO wdl_created_events (fixture_id, channel_id, scheduled_id, event_id, origin, created_at)
SELECT fixture_id, event_channel_id, scheduled_id, event_id, 'legacy', updated_at
FROM (
  SELECT fixture.fixture_id, fixture.event_channel_id, fixture.updated_at,
         CASE WHEN NOT EXISTS (SELECT 1 FROM wdl_created_events AS saved WHERE saved.scheduled_id = fixture.scheduled_id)
              THEN fixture.scheduled_id END AS scheduled_id,
         CASE WHEN NOT EXISTS (SELECT 1 FROM wdl_created_events AS saved WHERE saved.event_id = fixture.event_id)
              THEN fixture.event_id END AS event_id
  FROM wdl_fixture_events AS fixture
) AS missing
WHERE scheduled_id IS NOT NULL OR event_id IS NOT NULL
ON CONFLICT DO NOTHING;
