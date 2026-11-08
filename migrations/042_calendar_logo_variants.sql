ALTER TABLE wdl_matchday_icon_state
  DROP CONSTRAINT IF EXISTS wdl_matchday_icon_state_current_icon_check;

ALTER TABLE wdl_matchday_icon_state
  ADD CONSTRAINT wdl_matchday_icon_state_current_icon_check
  CHECK (current_icon IN ('default', 'matchday', 'newyear', 'remembrance', 'st-patricks', 'halloween', 'easter', 'christmas'));
