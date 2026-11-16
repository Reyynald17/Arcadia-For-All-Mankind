-- AUTO-GENERATED FILE. DO NOT EDIT BY HAND.
-- Source: supabase/migrations/*.sql
-- Regenerate with: npm run db:schema
-- Includes canonical schema, RLS policies, and reference seed data.
-- Safe to re-run against a Supabase project.

-- ===== 001_core_schema.sql =====

-- 001_core_schema.sql
-- Phase 0: canonical 1969 season schema. Additive and safe to re-run.
-- Legacy AP/RP/SI/IPI columns stay in place until the Phase 1 backend cutover.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Legacy base tables
-- These already exist in the live project. The IF NOT EXISTS definitions make
-- the migration set bootstrappable on a fresh Supabase project as well.
-- ---------------------------------------------------------------------------

create table if not exists agencies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  name text not null,
  country text,
  culture text,
  history text,
  targets text[],
  ap int default 25,
  budget int default 50,
  rp int default 0,
  si int default 70,
  ipi int default 60,
  slr int default 0,
  total_launches int default 0,
  successful_launches int default 0,
  created_at timestamptz default now()
);

create table if not exists technologies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  era text,
  research_cost_ap int default 0,
  research_cost_budget int default 0,
  duration_days int default 0,
  prerequisite text[],
  created_at timestamptz default now()
);

create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid references agencies(id) on delete set null,
  name text,
  type text,
  reliability int default 70,
  status text default 'testing',
  total_launches int default 0,
  successful_launches int default 0,
  created_at timestamptz default now()
);

create table if not exists missions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid references agencies(id) on delete set null,
  name text,
  vehicle_id uuid references vehicles(id) on delete set null,
  type text,
  result text,
  ap_cost int default 0,
  budget_cost int default 0,
  crew_deaths int default 0,
  launched_at timestamptz,
  completed_at timestamptz
);

create table if not exists logs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid references agencies(id) on delete set null,
  event_type text,
  description text,
  data jsonb,
  created_at timestamptz default now()
);

create table if not exists npcs (
  id uuid primary key default gen_random_uuid(),
  name text,
  archetype text,
  ap int default 25,
  budget int default 50,
  rp int default 0,
  si int default 70,
  ipi int default 60,
  slr int default 0,
  strategy jsonb,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Seasons
-- ---------------------------------------------------------------------------

create table if not exists seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_real_time timestamptz not null default now(),
  epoch_game_date date not null default '1969-07-20'::date,
  time_scale_multiplier numeric not null default 52.142857
    check (time_scale_multiplier > 0),
  western_tension int not null default 50
    check (western_tension between 0 and 100),
  eastern_tension int not null default 50
    check (eastern_tension between 0 and 100),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'PAUSED', 'COMPLETED')),
  created_at timestamptz not null default now()
);

create unique index if not exists seasons_single_active_idx
  on seasons ((status))
  where status = 'ACTIVE';

do $$
begin
  if not exists (select 1 from seasons where status = 'ACTIVE') then
    insert into seasons (name, start_real_time, epoch_game_date, status)
    values ('Season 1 - 1969', now(), '1969-07-20'::date, 'ACTIVE');
  end if;
end
$$;

create or replace function current_season_id()
returns uuid
language sql
stable
as $$
  select id
  from seasons
  where status = 'ACTIVE'
  order by start_real_time desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Agencies: canonical 1969 fields on top of the legacy stat columns
-- ---------------------------------------------------------------------------

alter table agencies
  add column if not exists season_id uuid default current_season_id(),
  add column if not exists code text,
  add column if not exists alignment text not null default 'INDEPENDENT',
  add column if not exists launch_site_lat numeric not null default 0,
  add column if not exists launch_site_lon numeric not null default 0,
  add column if not exists launch_site_name text,
  add column if not exists funding_usd bigint not null default 15000000,
  add column if not exists science_points numeric not null default 50,
  add column if not exists dependency_meter int not null default 0,
  add column if not exists western_standing int not null default 50,
  add column if not exists eastern_standing int not null default 50,
  add column if not exists total_engineers int not null default 30,
  add column if not exists profile_complete boolean not null default false,
  add column if not exists alignment_locked_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table agencies
  alter column season_id set default current_season_id();

update agencies
set season_id = current_season_id()
where season_id is null;

update agencies
set alignment = 'INDEPENDENT'
where alignment is null
   or alignment not in ('WESTERN', 'EASTERN', 'INDEPENDENT');

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agencies_season_id_fkey'
  ) then
    alter table agencies
      add constraint agencies_season_id_fkey
      foreign key (season_id) references seasons(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'agencies_alignment_check'
  ) then
    alter table agencies
      add constraint agencies_alignment_check
      check (alignment in ('WESTERN', 'EASTERN', 'INDEPENDENT'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'agencies_launch_site_check'
  ) then
    alter table agencies
      add constraint agencies_launch_site_check
      check (
        launch_site_lat between -90 and 90
        and launch_site_lon between -180 and 180
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'agencies_dependency_check'
  ) then
    alter table agencies
      add constraint agencies_dependency_check
      check (dependency_meter between 0 and 100);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'agencies_standing_check'
  ) then
    alter table agencies
      add constraint agencies_standing_check
      check (
        western_standing between 0 and 100
        and eastern_standing between 0 and 100
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'agencies_positive_resources_check'
  ) then
    alter table agencies
      add constraint agencies_positive_resources_check
      check (
        funding_usd >= 0
        and science_points >= 0
        and total_engineers >= 0
      );
  end if;
end
$$;

create unique index if not exists agencies_season_code_idx
  on agencies (season_id, code)
  where season_id is not null and code is not null;

create index if not exists agencies_season_idx on agencies (season_id);
create index if not exists agencies_user_idx on agencies (user_id);

comment on column agencies.ap is
  'Deprecated legacy stat retained read-only during the Phase 1 transition.';
comment on column agencies.budget is
  'Deprecated legacy stat retained read-only during the Phase 1 transition.';
comment on column agencies.science_points is
  'Canonical science budget used by the deterministic research engine.';
comment on column agencies.funding_usd is
  'Canonical funding budget in USD.';

-- ---------------------------------------------------------------------------
-- Technologies: canonical node catalog alongside legacy research columns
-- ---------------------------------------------------------------------------

alter table technologies
  add column if not exists node_id text,
  add column if not exists description text,
  add column if not exists discipline_id text,
  add column if not exists alignment_affinity text not null default 'ANY',
  add column if not exists era_number int,
  add column if not exists research_cost_science numeric not null default 0,
  add column if not exists research_cost_funding bigint not null default 0,
  add column if not exists base_days numeric not null default 0,
  add column if not exists prerequisite_node_ids text[] not null default '{}',
  add column if not exists unlock_trl int not null default 4,
  add column if not exists max_trl int not null default 9,
  add column if not exists base_failure_rate numeric not null default 0.15,
  add column if not exists min_failure_rate numeric not null default 0.008,
  add column if not exists static_test_cost bigint not null default 0,
  add column if not exists is_export_controlled boolean not null default false,
  add column if not exists dependency_impact int not null default 0,
  add column if not exists unlocks_parts text[] not null default '{}',
  add column if not exists spec jsonb not null default '{}'::jsonb;

update technologies
set node_id = case name
  when 'PROPULSI CAIR TAHAP I (LOX/RP-1)' then 'PROP_201_LOX_RP1'
  when 'TELEMETRI DUA ARAH & RADAR' then 'SCNC_101_VHF_TELEMETRY'
  when 'KAPSUL DUA AWAK VALORIA-MKII' then 'LIFE_201_TWO_CREW_CAPSULE'
  when 'STAGE SEPARATION & ULLAGE ROCKETS' then 'STRC_201_STAGE_SEPARATION'
  when 'CRYOGENIC HYDROGEN STAGE (LH2/LOX)' then 'WST_201_CRYO_HYDROLOX'
  when 'HEAT SHIELD ABLATIF KECEPATAN BULAN' then 'STRC_201_ABLATIVE_HEAT_SHIELD'
  else null
end
where node_id is null;

update technologies
set node_id = 'LEGACY_' || upper(substr(md5(lower(name) || id::text), 1, 8))
where node_id is null;

alter table technologies
  alter column node_id set not null;

update technologies
set era_number = case
  when era ~* 'TIER\s*0*[1-6]' then substring(era from '[1-6]')::int
  when btrim(era) ~ '^[1-6]$' then btrim(era)::int
  when era ~ '^1969' then 1
  when era ~ '^197' then 2
  when era ~ '^198' then 3
  when era ~ '^199' then 4
  else 1
end
where era_number is null;

alter table technologies
  alter column era_number set not null,
  alter column era_number set default 1;

update technologies
set discipline_id = case
  when name ilike '%PROPULSI%' or name ilike '%PROPULSION%' or name ilike '%STAGE%'
    then 'PROP'
  when name ilike '%STRUKTUR%' or name ilike '%AIRFRAME%' or name ilike '%HEAT SHIELD%'
    then 'STRC'
  when name ilike '%GUIDANCE%' or name ilike '%NAVIGATION%' or name ilike '%RENDEZVOUS%'
    then 'AVNC'
  when name ilike '%TELEMETRI%' or name ilike '%RADAR%' or name ilike '%COMMS%'
    then 'SCNC'
  when name ilike '%KAPSUL%' or name ilike '%CAPSULE%' or name ilike '%ECLSS%'
    then 'LIFE'
  when name ilike '%POWER%' or name ilike '%BATTERY%' or name ilike '%RTG%'
    then 'POWR'
  else null
end
where discipline_id is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'technologies_alignment_check'
  ) then
    alter table technologies
      add constraint technologies_alignment_check
      check (alignment_affinity in ('WESTERN', 'EASTERN', 'INDEPENDENT', 'ANY'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'technologies_discipline_check'
  ) then
    alter table technologies
      add constraint technologies_discipline_check
      check (
        discipline_id is null
        or discipline_id in ('PROP', 'STRC', 'AVNC', 'SCNC', 'LIFE', 'POWR')
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'technologies_era_check'
  ) then
    alter table technologies
      add constraint technologies_era_check
      check (era_number between 1 and 6);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'technologies_trl_check'
  ) then
    alter table technologies
      add constraint technologies_trl_check
      check (
        unlock_trl between 0 and 9
        and max_trl between 0 and 9
        and unlock_trl <= max_trl
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'technologies_failure_rate_check'
  ) then
    alter table technologies
      add constraint technologies_failure_rate_check
      check (
        base_failure_rate between 0 and 1
        and min_failure_rate between 0 and 1
        and min_failure_rate <= base_failure_rate
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'technologies_cost_check'
  ) then
    alter table technologies
      add constraint technologies_cost_check
      check (
        research_cost_science >= 0
        and research_cost_funding >= 0
        and base_days >= 0
        and static_test_cost >= 0
        and dependency_impact >= 0
      );
  end if;
end
$$;

create unique index if not exists technologies_node_id_idx
  on technologies (node_id);

create unique index if not exists technologies_name_lower_idx
  on technologies (lower(name));

create index if not exists technologies_discipline_era_idx
  on technologies (discipline_id, era_number);

create index if not exists technologies_prerequisites_idx
  on technologies using gin (prerequisite_node_ids);

comment on column technologies.research_cost_ap is
  'Deprecated legacy AP cost kept so the pre-Phase-1 UI remains functional.';
comment on column technologies.duration_days is
  'Deprecated legacy real-day duration; canonical timing uses base_days game days.';

-- ---------------------------------------------------------------------------
-- Agency tech progress and TRL
-- ---------------------------------------------------------------------------

create table if not exists agency_tech_nodes (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  node_id text not null
    references technologies(node_id) on update cascade on delete restrict,
  status text not null default 'LOCKED'
    check (status in ('LOCKED', 'AVAILABLE', 'RESEARCHING', 'UNLOCKED', 'EMBARGOED')),
  is_nationalized_variant boolean not null default false,
  assigned_engineers int not null default 0 check (assigned_engineers >= 0),
  research_started_at timestamptz,
  research_completes_at timestamptz,
  current_trl int not null default 0 check (current_trl between 0 and 9),
  trl_xp numeric not null default 0 check (trl_xp >= 0),
  total_activations int not null default 0 check (total_activations >= 0),
  failures_recorded int not null default 0 check (failures_recorded >= 0),
  license_status text not null default 'NONE'
    check (license_status in ('NONE', 'LICENSED', 'NATIONALIZED')),
  local_variant_of text
    references technologies(node_id) on update cascade on delete set null,
  nationalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, node_id)
);

create index if not exists agency_tech_nodes_agency_status_idx
  on agency_tech_nodes (agency_id, status);

-- ---------------------------------------------------------------------------
-- Deterministic scheduled event queue
-- ---------------------------------------------------------------------------

create table if not exists scheduled_events (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references seasons(id) on delete cascade,
  agency_id uuid references agencies(id) on delete cascade,
  event_type text not null,
  reference_id text not null,
  payload jsonb not null default '{}'::jsonb,
  execute_at timestamptz not null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PROCESSING', 'PROCESSED', 'CANCELLED', 'FAILED')),
  result_log jsonb,
  attempts int not null default 0 check (attempts >= 0),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists scheduled_events_pending_idx
  on scheduled_events (execute_at)
  where status = 'PENDING';

create index if not exists scheduled_events_agency_idx
  on scheduled_events (agency_id, status, execute_at);

-- ---------------------------------------------------------------------------
-- Tracking network
-- ---------------------------------------------------------------------------

create table if not exists ground_stations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  location text,
  lat numeric not null check (lat between -90 and 90),
  lon numeric not null check (lon between -180 and 180),
  min_elevation_deg numeric not null default 5
    check (min_elevation_deg between 0 and 90),
  asset_type text not null default 'GROUND'
    check (asset_type in ('GROUND', 'SHIP', 'RELAY')),
  faction text not null default 'NEUTRAL'
    check (faction in ('WESTERN', 'EASTERN', 'INDEPENDENT', 'NEUTRAL')),
  agency_id uuid references agencies(id) on delete set null,
  altitude_km numeric not null default 0 check (altitude_km >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists ground_stations_position_idx
  on ground_stations (lat, lon)
  where active;

-- ---------------------------------------------------------------------------
-- Parts and dependency tracking
-- ---------------------------------------------------------------------------

create table if not exists parts (
  part_id text primary key,
  name text not null,
  category text not null
    check (category in ('MAIN_ENGINE', 'AVIONICS', 'UPPER_STAGE', 'CAPSULE', 'OTHER')),
  origin_alignment text not null
    check (origin_alignment in ('WESTERN', 'EASTERN', 'INDEPENDENT')),
  unit_cost_usd bigint not null default 0 check (unit_cost_usd >= 0),
  mass_kg numeric check (mass_kg is null or mass_kg >= 0),
  dependency_weight int generated always as (
    case category
      when 'MAIN_ENGINE' then 8
      when 'AVIONICS' then 5
      when 'UPPER_STAGE' then 3
      when 'CAPSULE' then 3
      else 0
    end
  ) stored,
  created_at timestamptz not null default now()
);

create table if not exists agency_parts (
  agency_id uuid not null references agencies(id) on delete cascade,
  part_id text not null references parts(part_id) on update cascade on delete restrict,
  source text not null default 'IMPORTED'
    check (source in ('IMPORTED', 'LICENSED', 'LOCAL')),
  active_launches_12m int not null default 0 check (active_launches_12m >= 0),
  trl int not null default 4 check (trl between 0 and 9),
  cost_multiplier numeric not null default 1 check (cost_multiplier > 0),
  nationalized_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (agency_id, part_id)
);

-- ---------------------------------------------------------------------------
-- Missions and vehicles: orbital/flight-plan fields
-- ---------------------------------------------------------------------------

alter table missions
  add column if not exists season_id uuid default current_season_id()
    references seasons(id) on delete set null,
  add column if not exists status text not null default 'COMPLETED',
  add column if not exists scheduled_launch_at timestamptz,
  add column if not exists launch_site_lat numeric,
  add column if not exists launch_site_lon numeric,
  add column if not exists target_inclination_deg numeric,
  add column if not exists azimuth_deg numeric,
  add column if not exists mission_seed bigint,
  add column if not exists telemetry jsonb not null default '{}'::jsonb,
  add column if not exists outcome jsonb;

alter table missions
  alter column season_id set default current_season_id();

update missions
set season_id = current_season_id()
where season_id is null;

update missions
set launch_site_lat = a.launch_site_lat,
    launch_site_lon = a.launch_site_lon
from agencies a
where missions.agency_id = a.id
  and missions.launch_site_lat is null
  and missions.launch_site_lon is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'missions_status_check'
  ) then
    alter table missions
      add constraint missions_status_check
      check (status in (
        'PLANNED', 'ROLLOUT', 'COUNTDOWN', 'ASCENT', 'ORBIT',
        'COMPLETED', 'FAILED', 'ABORTED'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'missions_orbital_geometry_check'
  ) then
    alter table missions
      add constraint missions_orbital_geometry_check
      check (
        (launch_site_lat is null or launch_site_lat between -90 and 90)
        and (launch_site_lon is null or launch_site_lon between -180 and 180)
        and (target_inclination_deg is null or target_inclination_deg between 0 and 180)
        and (azimuth_deg is null or azimuth_deg between 0 and 360)
      );
  end if;
end
$$;

create index if not exists missions_agency_status_idx
  on missions (agency_id, status);

create index if not exists missions_season_idx on missions (season_id);

alter table vehicles
  add column if not exists trl int not null default 4
    check (trl between 0 and 9),
  add column if not exists architecture_family text,
  add column if not exists commonality int not null default 100
    check (commonality between 0 and 100),
  add column if not exists factory_line text,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists vehicles_agency_idx on vehicles (agency_id);

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists agencies_set_updated_at on agencies;
create trigger agencies_set_updated_at
  before update on agencies
  for each row execute function set_updated_at();

drop trigger if exists agency_tech_nodes_set_updated_at on agency_tech_nodes;
create trigger agency_tech_nodes_set_updated_at
  before update on agency_tech_nodes
  for each row execute function set_updated_at();

drop trigger if exists vehicles_set_updated_at on vehicles;
create trigger vehicles_set_updated_at
  before update on vehicles
  for each row execute function set_updated_at();

-- ===== 002_rls.sql =====

-- 002_rls.sql
-- Phase 0: read-only client access. All mutations go through the backend
-- service role, which bypasses RLS. Safe to re-run.

alter table seasons enable row level security;
alter table agencies enable row level security;
alter table technologies enable row level security;
alter table agency_tech_nodes enable row level security;
alter table scheduled_events enable row level security;
alter table ground_stations enable row level security;
alter table parts enable row level security;
alter table agency_parts enable row level security;
alter table vehicles enable row level security;
alter table missions enable row level security;
alter table logs enable row level security;
alter table npcs enable row level security;

-- Reference data ------------------------------------------------------------

drop policy if exists seasons_read on seasons;
create policy seasons_read on seasons
  for select to authenticated
  using (true);

drop policy if exists technologies_read on technologies;
create policy technologies_read on technologies
  for select to authenticated
  using (true);

drop policy if exists ground_stations_read on ground_stations;
create policy ground_stations_read on ground_stations
  for select to authenticated
  using (active);

drop policy if exists parts_read on parts;
create policy parts_read on parts
  for select to authenticated
  using (true);

drop policy if exists npcs_read on npcs;
create policy npcs_read on npcs
  for select to authenticated
  using (true);

-- Player-owned rows ---------------------------------------------------------

drop policy if exists agencies_read_own on agencies;
create policy agencies_read_own on agencies
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists agency_tech_nodes_read_own on agency_tech_nodes;
create policy agency_tech_nodes_read_own on agency_tech_nodes
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.id = agency_tech_nodes.agency_id
        and a.user_id = auth.uid()
    )
  );

drop policy if exists scheduled_events_read_own on scheduled_events;
create policy scheduled_events_read_own on scheduled_events
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.id = scheduled_events.agency_id
        and a.user_id = auth.uid()
    )
  );

drop policy if exists agency_parts_read_own on agency_parts;
create policy agency_parts_read_own on agency_parts
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.id = agency_parts.agency_id
        and a.user_id = auth.uid()
    )
  );

drop policy if exists vehicles_read_own on vehicles;
create policy vehicles_read_own on vehicles
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.id = vehicles.agency_id
        and a.user_id = auth.uid()
    )
  );

drop policy if exists missions_read_own on missions;
create policy missions_read_own on missions
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.id = missions.agency_id
        and a.user_id = auth.uid()
    )
  );

drop policy if exists logs_read_own on logs;
create policy logs_read_own on logs
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.id = logs.agency_id
        and a.user_id = auth.uid()
    )
  );

grant select on
  seasons,
  technologies,
  ground_stations,
  parts,
  npcs,
  agencies,
  agency_tech_nodes,
  scheduled_events,
  agency_parts,
  vehicles,
  missions,
  logs
to authenticated;

-- ===== 003_seed_tech.sql =====

-- 003_seed_tech.sql
-- Phase 0: starter catalog for Eras I-IV. Upserts by node_id and is safe to re-run.
-- Legacy display names are preserved for the six pre-existing nodes so that
-- research logs and the current UI keep resolving during the transition.

with catalog (
  node_id,
  name,
  title,
  description,
  discipline_id,
  era_number,
  alignment_affinity,
  science_points,
  funding_usd,
  base_days,
  unlock_trl,
  export_controlled,
  dependency_impact,
  prereqs
) as (
  values
    ('PROP_101_ALCOHOL_LOX', 'Alcohol/LOX Propulsion', 'Alcohol/LOX Propulsion', 'Pressure-fed alcohol and liquid oxygen engine for early sounding and orbital stages.', 'PROP', 1, 'ANY', 80, 1200000, 90, 4, false, 0, ARRAY[]::text[]),
    ('IND_101_SEGMENTED_SOLIDS', 'Segmented Solid Boosters', 'Segmented Solid Boosters', 'Castable segmented solid motors that can be clustered without cryogenic infrastructure.', 'PROP', 1, 'INDEPENDENT', 95, 1400000, 110, 4, false, 0, ARRAY[]::text[]),
    ('STRC_101_BASIC_AIRFRAME', 'Basic Airframe and Fins', 'Basic Airframe and Fins', 'Light alloy tank structures, stabilising fins, and separation interfaces for expendable launchers.', 'STRC', 1, 'ANY', 70, 1000000, 100, 4, false, 0, ARRAY[]::text[]),
    ('AVNC_101_INERTIAL_GUIDANCE', 'Inertial Guidance', 'Inertial Guidance', 'Gyroscope and accelerometer guidance with ground-based radio correction.', 'AVNC', 1, 'ANY', 80, 1100000, 100, 4, false, 0, ARRAY[]::text[]),
    ('SCNC_101_VHF_TELEMETRY', 'TELEMETRI DUA ARAH & RADAR', 'VHF Telemetry and Radar', 'Two-way VHF telemetry, command receivers, and acquisition radars for range safety.', 'SCNC', 1, 'ANY', 60, 900000, 80, 4, false, 0, ARRAY[]::text[]),
    ('LIFE_101_PRESSURIZED_CAPSULE', 'Pressurized Capsule', 'Pressurized Capsule', 'Sealed single-seat capsule with basic life support and ablative recovery.', 'LIFE', 1, 'ANY', 90, 1300000, 120, 4, false, 0, ARRAY['STRC_101_BASIC_AIRFRAME']::text[]),
    ('POWR_101_BATTERY_POWER', 'Silver-Zinc Battery Power', 'Silver-Zinc Battery Power', 'High-density silver-zinc cells for short-duration spacecraft electrical loads.', 'POWR', 1, 'ANY', 55, 800000, 70, 4, false, 0, ARRAY[]::text[]),
    ('PROP_201_LOX_RP1', 'PROPULSI CAIR TAHAP I (LOX/RP-1)', 'LOX/RP-1 Propulsion', 'Pump-fed kerosene and liquid oxygen propulsion for medium-lift first stages.', 'PROP', 2, 'ANY', 120, 2200000, 140, 4, false, 0, ARRAY['PROP_101_ALCOHOL_LOX']::text[]),
    ('WST_201_CRYO_HYDROLOX', 'CRYOGENIC HYDROGEN STAGE (LH2/LOX)', 'Cryogenic Hydrolox Upper Stage', 'High-energy liquid hydrogen upper stage with insulated tanks and restart capability.', 'PROP', 2, 'WESTERN', 150, 3200000, 160, 4, true, 12, ARRAY['PROP_201_LOX_RP1']::text[]),
    ('EST_201_HYPERGOLIC', 'Hypergolic Propulsion', 'Hypergolic Propulsion', 'Storable nitrogen-tetroxide and hydrazine engines for reliable upper-stage ignition.', 'PROP', 2, 'EASTERN', 150, 3200000, 160, 4, true, 12, ARRAY['PROP_201_LOX_RP1']::text[]),
    ('IND_201_MULTICORE_CLUSTERING', 'Multi-Core Strap-On Clustering', 'Multi-Core Strap-On Clustering', 'Parallel core and booster clustering with simplified propellant cross-feed.', 'STRC', 2, 'INDEPENDENT', 140, 2800000, 170, 4, false, 0, ARRAY['STRC_101_BASIC_AIRFRAME', 'PROP_101_ALCOHOL_LOX']::text[]),
    ('STRC_201_STAGE_SEPARATION', 'STAGE SEPARATION & ULLAGE ROCKETS', 'Stage Separation and Ullage', 'Cold-gas pushers, separation clamps, and ullage motors for reliable stage ignition.', 'STRC', 2, 'ANY', 110, 2000000, 140, 4, false, 0, ARRAY['STRC_101_BASIC_AIRFRAME']::text[]),
    ('STRC_201_ABLATIVE_HEAT_SHIELD', 'HEAT SHIELD ABLATIF KECEPATAN BULAN', 'Ablative Heat Shield', 'Lunar-return ablator, honeycomb carrier, and parachute recovery interface.', 'STRC', 2, 'ANY', 130, 2400000, 160, 4, false, 0, ARRAY['STRC_101_BASIC_AIRFRAME']::text[]),
    ('LIFE_201_TWO_CREW_CAPSULE', 'KAPSUL DUA AWAK VALORIA-MKII', 'Two-Crew Pressurized Capsule', 'Two-seat capsule with redundant life support, docking probe, and lunar-return rating.', 'LIFE', 2, 'ANY', 150, 2600000, 170, 4, false, 0, ARRAY['LIFE_101_PRESSURIZED_CAPSULE', 'STRC_201_ABLATIVE_HEAT_SHIELD']::text[]),
    ('AVNC_201_AUTOMATED_RENDEZVOUS', 'Automated Rendezvous and Docking', 'Automated Rendezvous and Docking', 'Radar-guided terminal rendezvous, attitude control, and hard-dock sequencing.', 'AVNC', 2, 'EASTERN', 160, 3000000, 180, 4, true, 15, ARRAY['AVNC_101_INERTIAL_GUIDANCE']::text[]),
    ('EST_301_STAGED_COMBUSTION', 'Closed-Cycle Staged Combustion', 'Closed-Cycle Staged Combustion', 'High-pressure staged-combustion engine cycle with regenerative cooling and deep throttling.', 'PROP', 3, 'EASTERN', 210, 4500000, 220, 4, true, 18, ARRAY['EST_201_HYPERGOLIC']::text[]),
    ('WST_301_DIGITAL_FLY_BY_WIRE', 'Digital Fly-by-Wire', 'Digital Fly-by-Wire', 'Redundant digital flight computers, rate gyros, and electrically signalled control surfaces.', 'AVNC', 3, 'WESTERN', 210, 4200000, 220, 4, true, 10, ARRAY['AVNC_101_INERTIAL_GUIDANCE']::text[]),
    ('WST_301_REUSABLE_TPS', 'Reusable TPS Tiles', 'Reusable Thermal Protection Tiles', 'Ceramic tile thermal protection, reusable seals, and post-flight inspection procedures.', 'STRC', 3, 'WESTERN', 220, 4800000, 240, 4, true, 10, ARRAY['STRC_201_ABLATIVE_HEAT_SHIELD']::text[]),
    ('IND_301_HYBRID_UPPER_STAGE', 'Hybrid Solid-Liquid Upper Stage', 'Hybrid Solid-Liquid Upper Stage', 'Hybrid upper stage with solid fuel grain, liquid oxidiser, and restartable ignition.', 'PROP', 3, 'INDEPENDENT', 200, 4000000, 230, 4, false, 0, ARRAY['IND_201_MULTICORE_CLUSTERING', 'PROP_201_LOX_RP1']::text[]),
    ('IND_302_CROSS_BLOC_ADAPTERS', 'Cross-Bloc Interface Adapters', 'Cross-Bloc Interface Adapters', 'Standardised payload adapters, ring interfaces, and local metallurgy for mixed supply chains.', 'STRC', 3, 'INDEPENDENT', 180, 3600000, 210, 4, false, 0, ARRAY['IND_201_MULTICORE_CLUSTERING']::text[]),
    ('LIFE_301_SEMI_CLOSED_ECLSS', 'Semi-Closed ECLSS', 'Semi-Closed ECLSS', 'Regenerative carbon dioxide removal, water recovery, and multi-crew cabin atmosphere control.', 'LIFE', 3, 'ANY', 200, 4200000, 230, 4, false, 0, ARRAY['LIFE_201_TWO_CREW_CAPSULE']::text[]),
    ('POWR_301_RTG', 'RTG Power Source', 'Radioisotope Thermoelectric Generator', 'Long-lived radioisotope power for deep-space probes and lunar surface payloads.', 'POWR', 3, 'ANY', 190, 3800000, 200, 4, false, 0, ARRAY['POWR_101_BATTERY_POWER']::text[]),
    ('SCNC_301_XBAND_DSN', 'X-Band Deep Space Comms', 'X-Band Deep Space Communications', 'High-gain X-band ground segment, ranging tones, and deep-space telemetry coding.', 'SCNC', 3, 'ANY', 180, 3500000, 200, 4, false, 0, ARRAY['SCNC_101_VHF_TELEMETRY']::text[]),
    ('PROP_401_PROPULSIVE_LANDING', 'Deep-Throttling Propulsive Landing', 'Deep-Throttling Propulsive Landing', 'Throttleable landing engine, gimbal authority, and terminal guidance for powered recovery.', 'PROP', 4, 'ANY', 300, 6500000, 300, 4, false, 0, ARRAY['PROP_201_LOX_RP1', 'AVNC_101_INERTIAL_GUIDANCE']::text[]),
    ('PROP_401_ION_THRUSTER', 'Ion Thruster', 'Gridded Ion Thruster', 'Electrostatic ion propulsion with high specific impulse for long-duration orbital transfers.', 'PROP', 4, 'ANY', 280, 6000000, 280, 4, false, 0, ARRAY['POWR_301_RTG']::text[]),
    ('LIFE_401_CLOSED_LOOP_ECLSS', 'Closed-Loop ECLSS', 'Closed-Loop ECLSS', 'Full air and water recycling for long-duration stations and interplanetary transit.', 'LIFE', 4, 'ANY', 280, 6200000, 300, 4, false, 0, ARRAY['LIFE_301_SEMI_CLOSED_ECLSS']::text[]),
    ('STRC_401_INFLATABLE_HABITAT', 'Inflatable Habitat', 'Inflatable Habitat', 'Multi-layer inflatable pressure shell with rigid core and deployable shielding.', 'STRC', 4, 'ANY', 290, 6300000, 300, 4, false, 0, ARRAY['STRC_201_ABLATIVE_HEAT_SHIELD']::text[]),
    ('POWR_401_SABATIER_ISRU', 'Sabatier ISRU', 'Sabatier In-Situ Resource Utilisation', 'Carbon dioxide and hydrogen processing for methane and water production on other worlds.', 'POWR', 4, 'ANY', 260, 5500000, 260, 4, false, 0, ARRAY['POWR_301_RTG']::text[]),
    ('IND_401_SEA_LAUNCH_PLATFORM', 'Equatorial Sea-Launch Platform', 'Equatorial Sea-Launch Platform', 'Mobile equatorial launch platform with azimuth flexibility and maritime range support.', 'STRC', 4, 'INDEPENDENT', 250, 5800000, 280, 4, false, 0, ARRAY['IND_302_CROSS_BLOC_ADAPTERS']::text[])
),
prepared as (
  select
    catalog.*,
    greatest(1, round(science_points / 10.0))::int as legacy_ap,
    greatest(1, round(funding_usd / 100000.0))::int as legacy_budget,
    greatest(1, ceil(base_days / 52.142857))::int as legacy_days,
    case node_id
      when 'PROP_101_ALCOHOL_LOX' then array['eng_alcohol_lox_basic']::text[]
      when 'PROP_201_LOX_RP1' then array['eng_lox_rp1_mid']::text[]
      when 'WST_201_CRYO_HYDROLOX' then array['eng_hydrolox_upper']::text[]
      when 'EST_201_HYPERGOLIC' then array['eng_hypergolic_upper']::text[]
      when 'EST_301_STAGED_COMBUSTION' then array['eng_rd253_heavy', 'eng_preburner_ox']::text[]
      when 'IND_301_HYBRID_UPPER_STAGE' then array['eng_hybrid_upper']::text[]
      when 'PROP_401_PROPULSIVE_LANDING' then array['eng_throttleable_lander']::text[]
      when 'PROP_401_ION_THRUSTER' then array['eng_ion_grid']::text[]
      else array[]::text[]
    end as unlocks_parts
  from catalog
)
insert into technologies (
  node_id,
  name,
  era,
  research_cost_ap,
  research_cost_budget,
  duration_days,
  prerequisite,
  description,
  discipline_id,
  alignment_affinity,
  era_number,
  research_cost_science,
  research_cost_funding,
  base_days,
  prerequisite_node_ids,
  unlock_trl,
  max_trl,
  base_failure_rate,
  min_failure_rate,
  static_test_cost,
  is_export_controlled,
  dependency_impact,
  unlocks_parts,
  spec
)
select
  node_id,
  name,
  'TIER 0' || era_number,
  legacy_ap,
  legacy_budget,
  legacy_days,
  array[]::text[],
  description,
  discipline_id,
  alignment_affinity,
  era_number,
  science_points,
  funding_usd,
  base_days,
  prereqs,
  unlock_trl,
  9,
  0.15,
  0.008,
  150000 * era_number,
  export_controlled,
  dependency_impact,
  unlocks_parts,
  jsonb_build_object(
    'id', node_id,
    'era', era_number,
    'discipline_id', discipline_id,
    'alignment_affinity', alignment_affinity,
    'title', title,
    'description', description,
    'prerequisites', jsonb_build_object(
      'tech_ids', to_jsonb(prereqs),
      'science_requirements', '[]'::jsonb
    ),
    'research_cost', jsonb_build_object(
      'science_points', science_points,
      'funding_usd', funding_usd,
      'base_days', base_days
    ),
    'cost_modifiers', case
      when alignment_affinity = 'ANY' then jsonb_build_object(
        'WESTERN', jsonb_build_object('science_mult', 1.0, 'days_mult', 1.0, 'requires_license', false),
        'EASTERN', jsonb_build_object('science_mult', 1.0, 'days_mult', 1.0, 'requires_license', false),
        'INDEPENDENT', jsonb_build_object('science_mult', 1.0, 'days_mult', 1.0, 'requires_license', false)
      )
      else jsonb_build_object(
        'WESTERN', jsonb_build_object(
          'science_mult', case when alignment_affinity = 'WESTERN' then 0.65 else 1.35 end,
          'days_mult', case when alignment_affinity = 'WESTERN' then 0.60 else 1.25 end,
          'requires_license', alignment_affinity = 'WESTERN'
        ),
        'EASTERN', jsonb_build_object(
          'science_mult', case when alignment_affinity = 'EASTERN' then 0.65 else 1.35 end,
          'days_mult', case when alignment_affinity = 'EASTERN' then 0.60 else 1.25 end,
          'requires_license', alignment_affinity = 'EASTERN'
        ),
        'INDEPENDENT', jsonb_build_object(
          'science_mult', case when alignment_affinity = 'INDEPENDENT' then 0.65 else 1.75 end,
          'days_mult', case when alignment_affinity = 'INDEPENDENT' then 0.60 else 1.60 end,
          'requires_license', false
        )
      )
    end,
    'embargo_risk', jsonb_build_object(
      'is_export_controlled', export_controlled,
      'dependency_impact', dependency_impact,
      'min_standing_required', case when export_controlled then 70 else 0 end,
      'fallback_local_variant', null
    ),
    'trl_profile', jsonb_build_object(
      'unlock_trl', unlock_trl,
      'max_trl', 9,
      'base_failure_rate', 0.15,
      'min_failure_rate', 0.008,
      'static_test_cost', 150000 * era_number
    ),
    'unlocks_parts', to_jsonb(unlocks_parts)
  )
from prepared
on conflict (node_id) do update set
  name = excluded.name,
  era = excluded.era,
  research_cost_ap = excluded.research_cost_ap,
  research_cost_budget = excluded.research_cost_budget,
  duration_days = excluded.duration_days,
  prerequisite = excluded.prerequisite,
  description = excluded.description,
  discipline_id = excluded.discipline_id,
  alignment_affinity = excluded.alignment_affinity,
  era_number = excluded.era_number,
  research_cost_science = excluded.research_cost_science,
  research_cost_funding = excluded.research_cost_funding,
  base_days = excluded.base_days,
  prerequisite_node_ids = excluded.prerequisite_node_ids,
  unlock_trl = excluded.unlock_trl,
  max_trl = excluded.max_trl,
  base_failure_rate = excluded.base_failure_rate,
  min_failure_rate = excluded.min_failure_rate,
  static_test_cost = excluded.static_test_cost,
  is_export_controlled = excluded.is_export_controlled,
  dependency_impact = excluded.dependency_impact,
  unlocks_parts = excluded.unlocks_parts,
  spec = excluded.spec;

-- Legacy backend reads names from the prerequisite array.
update technologies t
set prerequisite = coalesce(
  (
    select array_agg(p.name order by p.era_number, p.name)
    from technologies p
    where p.node_id = any(t.prerequisite_node_ids)
  ),
  '{}'::text[]
)
where cardinality(t.prerequisite_node_ids) > 0;

do $$
begin
  if exists (
    select 1
    from technologies t
    cross join lateral unnest(t.prerequisite_node_ids) as req(node_id)
    left join technologies p on p.node_id = req.node_id
    where p.id is null
  ) then
    raise exception 'Tech seed contains unresolved prerequisite node ids';
  end if;
end
$$;

-- ===== 004_seed_stations.sql =====

-- 004_seed_stations.sql
-- Phase 0: ground and ship tracking network. Upserts by station code.

with stations (
  code,
  name,
  location,
  lat,
  lon,
  min_elevation_deg,
  asset_type,
  faction,
  altitude_km
) as (
  values
    ('GDS_KOUROU', 'Guiana Space Centre', 'Kourou, French Guiana', 5.159, -52.649, 5, 'GROUND', 'WESTERN', 0),
    ('GDS_CAPE', 'Cape Canaveral', 'Florida, United States', 28.572, -80.649, 5, 'GROUND', 'WESTERN', 0),
    ('GDS_MADRID', 'Madrid Deep Space', 'Robledo de Chavela, Spain', 40.431, -4.248, 10, 'GROUND', 'WESTERN', 0),
    ('GDS_CARNARVON', 'Carnarvon Tracking', 'Western Australia', -24.882, 113.661, 5, 'GROUND', 'WESTERN', 0),
    ('GDS_PLESETSK', 'Plesetsk', 'Arkhangelsk Oblast, USSR', 62.927, 40.577, 5, 'GROUND', 'EASTERN', 0),
    ('GDS_BAIKONUR', 'Baikonur', 'Kazakhstan', 45.965, 63.305, 5, 'GROUND', 'EASTERN', 0),
    ('GDS_USUDA', 'Usuda Deep Space', 'Nagano, Japan', 36.132, 138.362, 10, 'GROUND', 'EASTERN', 0),
    ('GDS_SRIHARIKOTA', 'Sriharikota', 'Andhra Pradesh, India', 13.733, 80.235, 5, 'GROUND', 'INDEPENDENT', 0),
    ('GDS_TANEGASHIMA', 'Tanegashima', 'Kagoshima, Japan', 30.400, 130.969, 5, 'GROUND', 'INDEPENDENT', 0),
    ('GDS_SAN_MARCO', 'San Marco Platform', 'Indian Ocean off Kenya', -2.938, 40.212, 5, 'GROUND', 'INDEPENDENT', 0),
    ('GDS_TRACK_ATLANTIC', 'Atlantic Tracking Ship', 'Atlantic Ocean', 0.000, -30.000, 5, 'SHIP', 'NEUTRAL', 0),
    ('GDS_TRACK_PACIFIC', 'Pacific Tracking Ship', 'Pacific Ocean', 0.000, -150.000, 5, 'SHIP', 'NEUTRAL', 0)
)
insert into ground_stations (
  code,
  name,
  location,
  lat,
  lon,
  min_elevation_deg,
  asset_type,
  faction,
  altitude_km
)
select
  code,
  name,
  location,
  lat,
  lon,
  min_elevation_deg,
  asset_type,
  faction,
  altitude_km
from stations
on conflict (code) do update set
  name = excluded.name,
  location = excluded.location,
  lat = excluded.lat,
  lon = excluded.lon,
  min_elevation_deg = excluded.min_elevation_deg,
  asset_type = excluded.asset_type,
  faction = excluded.faction,
  altitude_km = excluded.altitude_km,
  active = true;
