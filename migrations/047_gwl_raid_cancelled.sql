ALTER TABLE gwl_raid_events DROP CONSTRAINT gwl_raid_events_state_check;
ALTER TABLE gwl_raid_events ADD CONSTRAINT gwl_raid_events_state_check
  CHECK (state IN ('pending', 'waiting', 'creating', 'scheduled', 'posted', 'review', 'uncertain', 'cancelled'));
