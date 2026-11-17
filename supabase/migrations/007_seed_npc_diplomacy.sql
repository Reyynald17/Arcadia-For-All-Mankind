-- 007_seed_npc_diplomacy.sql
-- Six NPC agencies per bloc. Idempotent by (season_id, code).
-- npc_profile stores only the behaviour key; numeric profile values live in
-- backend/src/config/diplomacyConfig.js and are never exposed by the API.

with npc_seed (
  code,
  name,
  country,
  bloc,
  alignment,
  profile,
  targets
) as (
  values
    ('NPC_WEST_MERIDIAN', 'Meridian Aerospace Agency', 'United States', 'western', 'WESTERN', 'cooperative', ARRAY['orbital', 'lunar']::text[]),
    ('NPC_WEST_ATLANTIC', 'Atlantic Space Consortium', 'United Kingdom', 'western', 'WESTERN', 'opportunistic', ARRAY['commercial', 'orbital']::text[]),
    ('NPC_WEST_PACIFIC', 'Pacific Orbital Authority', 'Japan', 'western', 'WESTERN', 'cooperative', ARRAY['science', 'orbital']::text[]),
    ('NPC_WEST_CASCADE', 'Cascade Rocketry Group', 'Canada', 'western', 'WESTERN', 'isolationist', ARRAY['sounding', 'defence']::text[]),
    ('NPC_WEST_ALBION', 'Albion Launch Directorate', 'United Kingdom', 'western', 'WESTERN', 'opportunistic', ARRAY['commercial', 'manned']::text[]),
    ('NPC_WEST_IBERIA', 'Iberia Space Institute', 'Spain', 'western', 'WESTERN', 'cooperative', ARRAY['science', 'tracking']::text[]),

    ('NPC_EAST_VOSTOK', 'Vostok State Bureau', 'Soviet Union', 'eastern', 'EASTERN', 'cooperative', ARRAY['orbital', 'manned']::text[]),
    ('NPC_EAST_RED_STAR', 'Red Star Propulsion Combine', 'Soviet Union', 'eastern', 'EASTERN', 'opportunistic', ARRAY['propulsion', 'heavy-lift']::text[]),
    ('NPC_EAST_ORIENT', 'Orient Heavy Lift Directorate', 'China', 'eastern', 'EASTERN', 'cooperative', ARRAY['heavy-lift', 'orbital']::text[]),
    ('NPC_EAST_STEPPE', 'Steppe Cosmodrome Authority', 'Kazakhstan', 'eastern', 'EASTERN', 'isolationist', ARRAY['range', 'defence']::text[]),
    ('NPC_EAST_DRAGON', 'Dragon River Aerospace', 'China', 'eastern', 'EASTERN', 'opportunistic', ARRAY['commercial', 'science']::text[]),
    ('NPC_EAST_AMUR', 'Amur Orbital Systems', 'Soviet Union', 'eastern', 'EASTERN', 'cooperative', ARRAY['orbital', 'tracking']::text[]),

    ('NPC_NEU_ALPINE', 'Alpine Space Laboratory', 'Switzerland', 'neutral', 'INDEPENDENT', 'cooperative', ARRAY['science', 'tracking']::text[]),
    ('NPC_NEU_SAHARA', 'Sahara Launch Cooperative', 'Algeria', 'neutral', 'INDEPENDENT', 'opportunistic', ARRAY['commercial', 'range']::text[]),
    ('NPC_NEU_ANDEAN', 'Andean Rocket Institute', 'Peru', 'neutral', 'INDEPENDENT', 'isolationist', ARRAY['sounding', 'science']::text[]),
    ('NPC_NEU_BALTIC', 'Baltic Orbital Union', 'Sweden', 'neutral', 'INDEPENDENT', 'cooperative', ARRAY['orbital', 'commercial']::text[]),
    ('NPC_NEU_CORAL', 'Coral Sea Launch Company', 'Australia', 'neutral', 'INDEPENDENT', 'opportunistic', ARRAY['commercial', 'range']::text[]),
    ('NPC_NEU_ZENITH', 'Zenith International', 'India', 'neutral', 'INDEPENDENT', 'isolationist', ARRAY['science', 'orbital']::text[])
)
insert into agencies (
  season_id,
  code,
  name,
  country,
  targets,
  alignment,
  bloc,
  controller_type,
  npc_profile,
  is_active,
  funding_usd,
  science_points,
  total_engineers,
  profile_complete
)
select
  current_season_id(),
  s.code,
  s.name,
  s.country,
  s.targets,
  s.alignment,
  s.bloc,
  'npc',
  jsonb_build_object('profile', s.profile),
  true,
  500000000,
  10000,
  80,
  true
from npc_seed s
where not exists (
  select 1
  from agencies a
  where a.season_id = current_season_id()
    and a.code = s.code
);

create index if not exists agencies_npc_active_idx
  on agencies (season_id, bloc)
  where controller_type = 'npc' and is_active;
