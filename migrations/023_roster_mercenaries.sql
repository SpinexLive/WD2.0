ALTER TABLE roster_assignments ALTER COLUMN discord_id DROP NOT NULL;
ALTER TABLE roster_assignments ADD COLUMN mercenary_id uuid;
ALTER TABLE roster_assignments ADD CONSTRAINT roster_assignment_identity
  CHECK ((discord_id IS NOT NULL AND mercenary_id IS NULL)
      OR (discord_id IS NULL AND mercenary_id IS NOT NULL AND avatar_url IS NULL));
ALTER TABLE roster_assignments ADD CONSTRAINT roster_mercenary_unique UNIQUE (roster_id, mercenary_id);
