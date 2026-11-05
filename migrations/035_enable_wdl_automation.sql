ALTER TABLE wdl_raid_settings ADD COLUMN activation_pending boolean NOT NULL DEFAULT false;

UPDATE wdl_raid_settings SET activation_pending = true WHERE id = 1 AND NOT enabled;
