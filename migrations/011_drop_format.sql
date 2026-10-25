-- The free-text "format" label is no longer used.
ALTER TABLE rosters DROP COLUMN IF EXISTS format;
UPDATE roster_templates SET definition = definition - 'format';
