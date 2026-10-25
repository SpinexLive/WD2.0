-- Competitive: Hotzone 12 + two Flex squads of 6 + FOB/Pilots/Anti Air/Recon of 2 = 32 players.
UPDATE roster_templates SET
  name = 'Competitive Match (32 players)',
  definition = '{
  "squads": [
    {"name":"Hotzone","category":"HOTZONE","size":12,"leaderRequired":true},
    {"name":"Flex 1","category":"FLEX","size":6,"leaderRequired":true},
    {"name":"Flex 2","category":"FLEX","size":6,"leaderRequired":true},
    {"name":"FOB","category":"FOB","size":2,"leaderRequired":false},
    {"name":"Pilots","category":"PILOTS","size":2,"leaderRequired":false},
    {"name":"Anti Air","category":"ANTI AIR","size":2,"leaderRequired":false},
    {"name":"Recon","category":"RECON","size":2,"leaderRequired":false}
  ]
}'::jsonb
WHERE key = 'competitive-32';

-- Weekly: a single squad of 5 with a squad leader.
UPDATE roster_templates SET
  definition = '{
  "squads": [
    {"name":"Squad 1","category":"SQUAD 1","size":5,"leaderRequired":true}
  ]
}'::jsonb
WHERE key = 'weekly-flex';
