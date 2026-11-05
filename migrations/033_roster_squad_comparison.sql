ALTER TABLE roster_squads ADD COLUMN compare_kd boolean NOT NULL DEFAULT false;

ALTER TABLE rosters ADD COLUMN content_updated_at timestamptz;
UPDATE rosters SET content_updated_at = updated_at;
ALTER TABLE rosters ALTER COLUMN content_updated_at SET DEFAULT now();
ALTER TABLE rosters ALTER COLUMN content_updated_at SET NOT NULL;
