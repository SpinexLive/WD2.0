ALTER TABLE scouting_events
  ADD COLUMN IF NOT EXISTS faction_a text CHECK (faction_a IN ('lonestar','manticore','valkyra')),
  ADD COLUMN IF NOT EXISTS faction_b text CHECK (faction_b IN ('lonestar','manticore','valkyra'));
