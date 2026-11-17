ALTER TABLE wdl_matchday_icon_state RENAME TO calendar_icon_state;
ALTER TABLE calendar_icon_state RENAME CONSTRAINT wdl_matchday_icon_state_pkey TO calendar_icon_state_pkey;
ALTER TABLE calendar_icon_state RENAME CONSTRAINT wdl_matchday_icon_state_id_check TO calendar_icon_state_id_check;
ALTER TABLE calendar_icon_state RENAME CONSTRAINT wdl_matchday_icon_state_current_icon_check TO calendar_icon_state_current_icon_check;
UPDATE rosters SET settings = settings - 'warnUnregistered';
ALTER TABLE rosters ALTER COLUMN settings SET DEFAULT '{}'::jsonb;
DELETE FROM audit_logs WHERE action LIKE 'wdl.%' OR action LIKE 'wdl_role.%'
  OR (target_type = 'application' AND action IN ('application.accept', 'application.reject', 'application.accept_failed', 'application.reject_failed'));

DROP TABLE wdl_result_reorder;
DROP TABLE wdl_result_post_status;
DROP TABLE wdl_result_posts;
DROP TABLE wdl_created_events;
DROP TABLE wdl_raid_tests;
DROP TABLE wdl_fixture_events;
DROP TABLE wdl_raid_settings;
DROP TABLE wdl_fixture_archive;
DROP TABLE wdl_role_settings;
