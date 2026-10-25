-- Wardogs presets (the earlier built-ins were modelled on the base game). Existing rosters keep their own squads.
UPDATE roster_templates SET
  key = 'competitive-32',
  name = 'Competitive Match (32 players)',
  definition = '{
  "format": "Hotzone",
  "squads": [
    {"name":"Hotzone 1","category":"HOTZONE 1","size":10,"required":true,"leaderRequired":true},
    {"name":"Hotzone 2","category":"HOTZONE 2","size":10,"required":true,"leaderRequired":true},
    {"name":"Recon","category":"RECON","size":2,"required":true,"leaderRequired":false},
    {"name":"Pilots","category":"PILOTS","size":2,"required":true,"leaderRequired":false},
    {"name":"FOB","category":"FOB","size":2,"required":true,"leaderRequired":false},
    {"name":"Anti Air","category":"ANTI AIR","size":2,"required":true,"leaderRequired":false},
    {"name":"Flex","category":"FLEX","size":4,"required":false,"leaderRequired":false}
  ]}'::jsonb
WHERE key = 'competitive-49';

UPDATE roster_templates SET
  name = 'Weekly Event (flexible)',
  definition = '{
  "format": "",
  "squads": [
    {"name":"Hotzone 1","category":"HOTZONE 1","size":10,"required":false,"leaderRequired":true},
    {"name":"Hotzone 2","category":"HOTZONE 2","size":10,"required":false,"leaderRequired":true},
    {"name":"Flex","category":"FLEX","size":6,"required":false,"leaderRequired":false}
  ]}'::jsonb
WHERE key = 'weekly-flex';
