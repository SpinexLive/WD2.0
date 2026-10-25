-- Every squad is required, so the per-squad flag is gone.
ALTER TABLE roster_squads DROP COLUMN IF EXISTS required;

UPDATE roster_templates SET definition = jsonb_set(
  definition,
  '{squads}',
  (SELECT COALESCE(jsonb_agg(e - 'required'), '[]'::jsonb) FROM jsonb_array_elements(definition->'squads') e)
);
