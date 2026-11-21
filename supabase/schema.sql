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

-- ===== 005_diplomacy.sql =====

-- 005_diplomacy.sql
-- Diplomacy MVP schema. Additive and safe to re-run.
-- Balance values are supplied by the backend config module; this migration only
-- stores state and provides the atomic acceptance transaction.

-- ---------------------------------------------------------------------------
-- Agencies: canonical bloc metadata on top of the legacy alignment column
-- ---------------------------------------------------------------------------

alter table agencies
  add column if not exists bloc text,
  add column if not exists controller_type text,
  add column if not exists npc_profile jsonb,
  add column if not exists is_active boolean;

update agencies
set bloc = case upper(coalesce(alignment, 'INDEPENDENT'))
  when 'WESTERN' then 'western'
  when 'EASTERN' then 'eastern'
  else 'neutral'
end
where bloc is null
   or bloc not in ('western', 'eastern', 'neutral');

alter table agencies alter column bloc set default 'neutral';
alter table agencies alter column bloc set not null;

update agencies
set controller_type = case
  when code like 'NPC\_%' escape '\' then 'npc'
  else 'player'
end
where controller_type is null
   or controller_type not in ('player', 'npc');

alter table agencies alter column controller_type set default 'player';
alter table agencies alter column controller_type set not null;

update agencies
set is_active = true
where is_active is null;

alter table agencies alter column is_active set default true;
alter table agencies alter column is_active set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agencies_bloc_check'
  ) then
    alter table agencies
      add constraint agencies_bloc_check
      check (bloc in ('western', 'eastern', 'neutral'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'agencies_controller_type_check'
  ) then
    alter table agencies
      add constraint agencies_controller_type_check
      check (controller_type in ('player', 'npc'));
  end if;
end
$$;

create index if not exists agencies_bloc_active_idx
  on agencies (season_id, bloc, is_active);
create index if not exists agencies_controller_active_idx
  on agencies (season_id, controller_type, is_active);

comment on column agencies.bloc is
  'Diplomacy bloc: western, eastern, or neutral. Legacy alignment remains for tech modifiers.';
comment on column agencies.controller_type is
  'player when controlled through the API, npc when driven by the deterministic diplomacy tick.';
comment on column agencies.npc_profile is
  'Server-only NPC behaviour profile. Never expose through public agency APIs.';
comment on column agencies.is_active is
  'Inactive agencies remain in history but are excluded from diplomacy and bloc counts.';

-- ---------------------------------------------------------------------------
-- Relations, proposals, agreements, audit log
-- ---------------------------------------------------------------------------

create table if not exists agency_relations (
  id uuid primary key default gen_random_uuid(),
  agency_low_id uuid not null references agencies(id) on delete cascade,
  agency_high_id uuid not null references agencies(id) on delete cascade,
  relation_score int not null default 50
    check (relation_score between 0 and 100),
  status text not null default 'neutral'
    check (status in ('neutral', 'cooperative', 'allied', 'sanctioned')),
  cooldown_until timestamptz,
  last_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agency_relations_distinct check (agency_low_id <> agency_high_id),
  constraint agency_relations_normalized check (agency_low_id < agency_high_id),
  constraint agency_relations_pair_key unique (agency_low_id, agency_high_id)
);

create index if not exists agency_relations_low_idx
  on agency_relations (agency_low_id);
create index if not exists agency_relations_high_idx
  on agency_relations (agency_high_id);
create index if not exists agency_relations_cooldown_idx
  on agency_relations (cooldown_until);

create table if not exists diplomatic_proposals (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references seasons(id) on delete cascade,
  from_agency_id uuid not null references agencies(id) on delete cascade,
  to_agency_id uuid not null references agencies(id) on delete cascade,
  proposal_type text not null default 'cooperation'
    check (proposal_type in ('cooperation')),
  terms jsonb not null default '{}'::jsonb,
  note text check (note is null or char_length(note) <= 280),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'expired', 'withdrawn', 'countered')),
  parent_proposal_id uuid references diplomatic_proposals(id) on delete set null,
  expires_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint diplomatic_proposals_distinct check (from_agency_id <> to_agency_id)
);

create unique index if not exists diplomatic_proposals_pending_pair_idx
  on diplomatic_proposals (
    least(from_agency_id, to_agency_id),
    greatest(from_agency_id, to_agency_id),
    proposal_type
  )
  where status = 'pending';
create index if not exists diplomatic_proposals_inbox_idx
  on diplomatic_proposals (to_agency_id, status, expires_at);
create index if not exists diplomatic_proposals_outbox_idx
  on diplomatic_proposals (from_agency_id, status, expires_at);
create index if not exists diplomatic_proposals_expiry_idx
  on diplomatic_proposals (status, expires_at);
create index if not exists diplomatic_proposals_season_idx
  on diplomatic_proposals (season_id);

create table if not exists agency_agreements (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references seasons(id) on delete cascade,
  party_low_id uuid not null references agencies(id) on delete cascade,
  party_high_id uuid not null references agencies(id) on delete cascade,
  agreement_type text not null default 'cooperation'
    check (agreement_type in ('cooperation')),
  terms jsonb not null default '{}'::jsonb,
  status text not null default 'active'
    check (status in ('active', 'expired', 'terminated')),
  source_proposal_id uuid references diplomatic_proposals(id) on delete set null,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  next_payment_at timestamptz,
  terminated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agency_agreements_distinct check (party_low_id <> party_high_id),
  constraint agency_agreements_normalized check (party_low_id < party_high_id)
);

create index if not exists agency_agreements_low_idx
  on agency_agreements (party_low_id, status);
create index if not exists agency_agreements_high_idx
  on agency_agreements (party_high_id, status);
create index if not exists agency_agreements_live_idx
  on agency_agreements (status, ends_at);
create index if not exists agency_agreements_season_idx
  on agency_agreements (season_id);

create table if not exists diplomatic_events (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references seasons(id) on delete cascade,
  actor_agency_id uuid references agencies(id) on delete set null,
  counterpart_agency_id uuid references agencies(id) on delete set null,
  event_type text not null,
  proposal_id uuid references diplomatic_proposals(id) on delete set null,
  agreement_id uuid references agency_agreements(id) on delete set null,
  description text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists diplomatic_events_actor_idx
  on diplomatic_events (actor_agency_id, created_at desc);
create index if not exists diplomatic_events_counterpart_idx
  on diplomatic_events (counterpart_agency_id, created_at desc);
create index if not exists diplomatic_events_proposal_idx
  on diplomatic_events (proposal_id);
create index if not exists diplomatic_events_agreement_idx
  on diplomatic_events (agreement_id);

-- Persisted saturation evaluation. Only neutral agencies have rows because
-- saturation is a neutral-agency soft cap against western/eastern blocs.
create table if not exists agency_bloc_saturation (
  agency_id uuid not null references agencies(id) on delete cascade,
  bloc text not null check (bloc in ('western', 'eastern', 'neutral')),
  counterpart_count int not null default 0 check (counterpart_count >= 0),
  bloc_agency_count int not null default 0 check (bloc_agency_count >= 0),
  threshold int not null default 0 check (threshold >= 0),
  is_saturated boolean not null default false,
  evaluated_at timestamptz not null default now(),
  primary key (agency_id, bloc)
);

create index if not exists agency_bloc_saturation_evaluated_idx
  on agency_bloc_saturation (evaluated_at);

drop trigger if exists agency_relations_set_updated_at on agency_relations;
create trigger agency_relations_set_updated_at
  before update on agency_relations
  for each row execute function set_updated_at();

drop trigger if exists diplomatic_proposals_set_updated_at on diplomatic_proposals;
create trigger diplomatic_proposals_set_updated_at
  before update on diplomatic_proposals
  for each row execute function set_updated_at();

drop trigger if exists agency_agreements_set_updated_at on agency_agreements;
create trigger agency_agreements_set_updated_at
  before update on agency_agreements
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Saturation helpers
-- ---------------------------------------------------------------------------

create or replace function diplomacy_bloc_size(
  p_bloc text,
  p_season_id uuid
)
returns int
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select count(*)::int
  from agencies a
  where a.bloc = p_bloc
    and a.is_active
    and (p_season_id is null or a.season_id = p_season_id);
$$;

create or replace function diplomacy_counterpart_count(
  p_agency_id uuid,
  p_bloc text,
  p_season_id uuid,
  p_at timestamptz
)
returns int
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select count(distinct
    case
      when ag.party_low_id = p_agency_id then ag.party_high_id
      else ag.party_low_id
    end
  )::int
  from agency_agreements ag
  join agencies other
    on other.id = case
      when ag.party_low_id = p_agency_id then ag.party_high_id
      else ag.party_low_id
    end
  where (ag.party_low_id = p_agency_id or ag.party_high_id = p_agency_id)
    and ag.status = 'active'
    and ag.ends_at > p_at
    and ag.agreement_type = 'cooperation'
    and other.is_active
    and other.bloc = p_bloc
    and (p_season_id is null or other.season_id = p_season_id);
$$;

create or replace function diplomacy_saturation_snapshot(
  p_agency_id uuid,
  p_bloc text,
  p_ratio numeric,
  p_at timestamptz
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_season_id uuid;
  v_bloc_size int;
  v_counterparts int;
  v_threshold int;
  v_saturated boolean;
begin
  select a.season_id into v_season_id
  from agencies a
  where a.id = p_agency_id;

  if not found then
    raise exception using message = 'AGENCY_NOT_FOUND';
  end if;

  v_bloc_size := diplomacy_bloc_size(p_bloc, v_season_id);
  v_counterparts := diplomacy_counterpart_count(p_agency_id, p_bloc, v_season_id, p_at);
  v_threshold := ceil(greatest(coalesce(p_ratio, 0), 0) * v_bloc_size)::int;
  v_saturated := v_bloc_size > 0
    and v_counterparts > 0
    and v_counterparts >= v_threshold;

  return jsonb_build_object(
    'agency_id', p_agency_id,
    'bloc', p_bloc,
    'counterpart_count', v_counterparts,
    'bloc_agency_count', v_bloc_size,
    'threshold', v_threshold,
    'is_saturated', v_saturated
  );
end;
$$;

create or replace function diplomacy_refresh_saturation(
  p_agency_id uuid,
  p_ratio numeric,
  p_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_bloc text;
  v_snapshot jsonb;
begin
  if not exists (
    select 1 from agencies a where a.id = p_agency_id and a.bloc = 'neutral'
  ) then
    return;
  end if;

  foreach v_bloc in array array['western', 'eastern']
  loop
    v_snapshot := diplomacy_saturation_snapshot(p_agency_id, v_bloc, p_ratio, p_at);

    insert into agency_bloc_saturation (
      agency_id,
      bloc,
      counterpart_count,
      bloc_agency_count,
      threshold,
      is_saturated,
      evaluated_at
    )
    values (
      p_agency_id,
      v_bloc,
      (v_snapshot ->> 'counterpart_count')::int,
      (v_snapshot ->> 'bloc_agency_count')::int,
      (v_snapshot ->> 'threshold')::int,
      (v_snapshot ->> 'is_saturated')::boolean,
      p_at
    )
    on conflict (agency_id, bloc) do update
      set counterpart_count = excluded.counterpart_count,
          bloc_agency_count = excluded.bloc_agency_count,
          threshold = excluded.threshold,
          is_saturated = excluded.is_saturated,
          evaluated_at = excluded.evaluated_at;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Atomic acceptance: agreement creation + saturation re-check + cooldown +
-- audit log + agreement-expiry event all happen in one transaction.
-- ---------------------------------------------------------------------------

create or replace function accept_diplomatic_proposal(
  p_proposal_id uuid,
  p_actor_agency_id uuid,
  p_saturation_ratio numeric,
  p_allowed_durations int[],
  p_initial_score int,
  p_relation_gain int,
  p_cooldown_seconds int,
  p_cross_bloc_cooldown_seconds int,
  p_min_score int,
  p_max_score int,
  p_cooperative_threshold int,
  p_allied_threshold int
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_proposal diplomatic_proposals%rowtype;
  v_from agencies%rowtype;
  v_to agencies%rowtype;
  v_duration int;
  v_cooldown_seconds int;
  v_ends_at timestamptz;
  v_multiplier numeric;
  v_season_id uuid;
  v_relation agency_relations%rowtype;
  v_agreement agency_agreements%rowtype;
  v_snapshot jsonb;
  v_score int;
  v_status text;
begin
  select * into v_proposal
  from diplomatic_proposals
  where id = p_proposal_id
  for update;

  if not found then
    raise exception using message = 'PROPOSAL_NOT_FOUND';
  end if;

  if v_proposal.to_agency_id <> p_actor_agency_id then
    raise exception using message = 'FORBIDDEN_PROPOSAL';
  end if;

  if v_proposal.status <> 'pending' then
    raise exception using message = 'PROPOSAL_NOT_PENDING';
  end if;

  if v_proposal.expires_at <= now() then
    update diplomatic_proposals
    set status = 'expired',
        responded_at = now(),
        updated_at = now()
    where id = v_proposal.id
      and status = 'pending';

    insert into diplomatic_events (
      season_id,
      actor_agency_id,
      counterpart_agency_id,
      event_type,
      proposal_id,
      description,
      data
    )
    values (
      v_proposal.season_id,
      v_proposal.to_agency_id,
      v_proposal.from_agency_id,
      'DIPLOMACY_PROPOSAL_EXPIRED',
      v_proposal.id,
      'Proposal expired before acceptance.',
      jsonb_build_object('reason', 'expired_before_accept')
    );

    return jsonb_build_object('error', 'PROPOSAL_EXPIRED');
  end if;

  select * into v_from from agencies where id = v_proposal.from_agency_id;
  select * into v_to from agencies where id = v_proposal.to_agency_id;

  if v_from.id is null or v_to.id is null then
    raise exception using message = 'AGENCY_NOT_FOUND';
  end if;

  if not v_from.is_active or not v_to.is_active then
    raise exception using message = 'AGENCY_INACTIVE';
  end if;

  if v_from.season_id is distinct from v_to.season_id then
    raise exception using message = 'SEASON_MISMATCH';
  end if;

  v_duration := nullif(v_proposal.terms ->> 'duration_days', '')::int;
  if v_duration is null
     or not (v_duration = any(coalesce(p_allowed_durations, array[]::int[]))) then
    raise exception using message = 'INVALID_DURATION';
  end if;

  -- Serialise saturation checks for the same neutral agency/bloc.
  if v_from.bloc = 'neutral' and v_to.bloc in ('western', 'eastern') then
    perform pg_advisory_xact_lock(
      hashtext('diplomacy_saturation'),
      hashtext(v_from.id::text || ':' || v_to.bloc)
    );

    v_snapshot := diplomacy_saturation_snapshot(
      v_from.id,
      v_to.bloc,
      p_saturation_ratio,
      now()
    );

    if (v_snapshot ->> 'is_saturated')::boolean then
      raise exception using message = upper(v_to.bloc) || '_SATURATED';
    end if;
  end if;

  if v_to.bloc = 'neutral' and v_from.bloc in ('western', 'eastern') then
    perform pg_advisory_xact_lock(
      hashtext('diplomacy_saturation'),
      hashtext(v_to.id::text || ':' || v_from.bloc)
    );

    v_snapshot := diplomacy_saturation_snapshot(
      v_to.id,
      v_from.bloc,
      p_saturation_ratio,
      now()
    );

    if (v_snapshot ->> 'is_saturated')::boolean then
      raise exception using message = upper(v_from.bloc) || '_SATURATED';
    end if;
  end if;

  v_season_id := coalesce(v_from.season_id, current_season_id());
  v_cooldown_seconds := case
    when v_from.bloc in ('western', 'eastern')
      and v_to.bloc in ('western', 'eastern')
      and v_from.bloc <> v_to.bloc
      then p_cross_bloc_cooldown_seconds
    else p_cooldown_seconds
  end;

  v_score := least(
    p_max_score,
    greatest(p_min_score, p_initial_score + p_relation_gain)
  );
  v_status := case
    when v_score >= p_allied_threshold then 'allied'
    when v_score >= p_cooperative_threshold then 'cooperative'
    else 'neutral'
  end;

  insert into agency_relations as rel (
    agency_low_id,
    agency_high_id,
    relation_score,
    status,
    cooldown_until,
    last_action_at
  )
  values (
    least(v_from.id, v_to.id),
    greatest(v_from.id, v_to.id),
    v_score,
    v_status,
    now() + make_interval(secs => greatest(v_cooldown_seconds, 0)),
    now()
  )
  on conflict (agency_low_id, agency_high_id) do update
    set relation_score = least(
          p_max_score,
          greatest(p_min_score, rel.relation_score + p_relation_gain)
        ),
        status = case
          when least(p_max_score, greatest(p_min_score, rel.relation_score + p_relation_gain))
            >= p_allied_threshold then 'allied'
          when least(p_max_score, greatest(p_min_score, rel.relation_score + p_relation_gain))
            >= p_cooperative_threshold then 'cooperative'
          else 'neutral'
        end,
        cooldown_until = excluded.cooldown_until,
        last_action_at = excluded.last_action_at,
        updated_at = now()
  returning * into v_relation;

  select coalesce(time_scale_multiplier, 52.142857)
  into v_multiplier
  from seasons
  where id = v_season_id;

  if v_multiplier is null or v_multiplier <= 0 then
    v_multiplier := 52.142857;
  end if;

  v_ends_at := now() + (v_duration::double precision / v_multiplier::double precision) * interval '1 day';

  insert into agency_agreements (
    season_id,
    party_low_id,
    party_high_id,
    agreement_type,
    terms,
    status,
    source_proposal_id,
    started_at,
    ends_at
  )
  values (
    v_season_id,
    least(v_from.id, v_to.id),
    greatest(v_from.id, v_to.id),
    v_proposal.proposal_type,
    v_proposal.terms,
    'active',
    v_proposal.id,
    now(),
    v_ends_at
  )
  returning * into v_agreement;

  update diplomatic_proposals
  set status = 'accepted',
      responded_at = now(),
      updated_at = now()
  where id = v_proposal.id
    and status = 'pending';

  insert into diplomatic_events (
    season_id,
    actor_agency_id,
    counterpart_agency_id,
    event_type,
    proposal_id,
    agreement_id,
    description,
    data
  )
  values (
    v_season_id,
    v_to.id,
    v_from.id,
    'DIPLOMACY_PROPOSAL_ACCEPTED',
    v_proposal.id,
    v_agreement.id,
    'Proposal accepted.',
    jsonb_build_object(
      'agreement_type', v_agreement.agreement_type,
      'duration_days', v_duration,
      'cross_bloc', (
        v_from.bloc in ('western', 'eastern')
        and v_to.bloc in ('western', 'eastern')
        and v_from.bloc <> v_to.bloc
      )
    )
  );

  insert into diplomatic_events (
    season_id,
    actor_agency_id,
    counterpart_agency_id,
    event_type,
    proposal_id,
    agreement_id,
    description,
    data
  )
  values (
    v_season_id,
    v_to.id,
    v_from.id,
    'DIPLOMACY_AGREEMENT_CREATED',
    v_proposal.id,
    v_agreement.id,
    'Cooperation agreement is now active.',
    jsonb_build_object(
      'agreement_type', v_agreement.agreement_type,
      'duration_days', v_duration,
      'ends_at', v_agreement.ends_at
    )
  );

  insert into scheduled_events (
    season_id,
    agency_id,
    event_type,
    reference_id,
    payload,
    execute_at,
    status
  )
  values (
    v_season_id,
    v_to.id,
    'DIPLOMACY_AGREEMENT_EXPIRED',
    v_agreement.id::text,
    jsonb_build_object(
      'agreement_id', v_agreement.id,
      'ends_at', v_agreement.ends_at
    ),
    v_agreement.ends_at,
    'PENDING'
  );

  perform diplomacy_refresh_saturation(v_from.id, p_saturation_ratio, now());
  perform diplomacy_refresh_saturation(v_to.id, p_saturation_ratio, now());

  return jsonb_build_object(
    'agreement', to_jsonb(v_agreement),
    'relation', to_jsonb(v_relation)
  );
end;
$$;

-- Backend-only execution. The API authenticates and authorises the actor before
-- calling these functions with the service role.
revoke all on function diplomacy_bloc_size(text, uuid) from public, anon, authenticated;
revoke all on function diplomacy_counterpart_count(uuid, text, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function diplomacy_saturation_snapshot(uuid, text, numeric, timestamptz)
  from public, anon, authenticated;
revoke all on function diplomacy_refresh_saturation(uuid, numeric, timestamptz)
  from public, anon, authenticated;
revoke all on function accept_diplomatic_proposal(
  uuid, uuid, numeric, int[], int, int, int, int, int, int, int, int
) from public, anon, authenticated;

grant execute on function diplomacy_bloc_size(text, uuid) to service_role;
grant execute on function diplomacy_counterpart_count(uuid, text, uuid, timestamptz)
  to service_role;
grant execute on function diplomacy_saturation_snapshot(uuid, text, numeric, timestamptz)
  to service_role;
grant execute on function diplomacy_refresh_saturation(uuid, numeric, timestamptz)
  to service_role;
grant execute on function accept_diplomatic_proposal(
  uuid, uuid, numeric, int[], int, int, int, int, int, int, int, int
) to service_role;

-- ===== 006_diplomacy_rls.sql =====

-- 006_diplomacy_rls.sql
-- Diplomacy MVP: read-only client access to rows involving the player's own
-- agency. All writes stay behind the backend service role, which bypasses RLS.

alter table agency_relations enable row level security;
alter table diplomatic_proposals enable row level security;
alter table agency_agreements enable row level security;
alter table diplomatic_events enable row level security;
alter table agency_bloc_saturation enable row level security;

drop policy if exists agency_relations_read_own on agency_relations;
create policy agency_relations_read_own on agency_relations
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.user_id = auth.uid()
        and (
          a.id = agency_relations.agency_low_id
          or a.id = agency_relations.agency_high_id
        )
    )
  );

drop policy if exists diplomatic_proposals_read_own on diplomatic_proposals;
create policy diplomatic_proposals_read_own on diplomatic_proposals
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.user_id = auth.uid()
        and (
          a.id = diplomatic_proposals.from_agency_id
          or a.id = diplomatic_proposals.to_agency_id
        )
    )
  );

drop policy if exists agency_agreements_read_own on agency_agreements;
create policy agency_agreements_read_own on agency_agreements
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.user_id = auth.uid()
        and (
          a.id = agency_agreements.party_low_id
          or a.id = agency_agreements.party_high_id
        )
    )
  );

drop policy if exists diplomatic_events_read_own on diplomatic_events;
create policy diplomatic_events_read_own on diplomatic_events
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.user_id = auth.uid()
        and (
          a.id = diplomatic_events.actor_agency_id
          or a.id = diplomatic_events.counterpart_agency_id
        )
    )
  );

drop policy if exists agency_bloc_saturation_read_own on agency_bloc_saturation;
create policy agency_bloc_saturation_read_own on agency_bloc_saturation
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.user_id = auth.uid()
        and a.id = agency_bloc_saturation.agency_id
    )
  );

grant select on
  agency_relations,
  diplomatic_proposals,
  agency_agreements,
  diplomatic_events,
  agency_bloc_saturation
to authenticated;

-- ===== 007_seed_npc_diplomacy.sql =====

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

-- ===== 008_economy.sql =====

-- 008_economy.sql
-- Contracts, one-time grants, mission rewards, and the sequential mission queue.
-- Additive and safe to re-run. Apply only with owner approval on shared projects.

create table if not exists agency_contracts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  season_id uuid default current_season_id() references seasons(id) on delete cascade,
  contract_key text not null,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'COMPLETED', 'FAILED', 'CANCELLED')),
  mission_id uuid references missions(id) on delete set null,
  payout_funding_usd bigint not null default 0 check (payout_funding_usd >= 0),
  reward_rp int not null default 0 check (reward_rp >= 0),
  reward_science numeric not null default 0 check (reward_science >= 0),
  accepted_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, contract_key)
);

create index if not exists agency_contracts_agency_status_idx
  on agency_contracts (agency_id, status);
create index if not exists agency_contracts_mission_idx
  on agency_contracts (mission_id);

create table if not exists agency_grants (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  season_id uuid default current_season_id() references seasons(id) on delete cascade,
  grant_key text not null,
  amount_funding_usd bigint not null default 0 check (amount_funding_usd >= 0),
  amount_science numeric not null default 0 check (amount_science >= 0),
  claimed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (agency_id, grant_key)
);

create index if not exists agency_grants_agency_idx
  on agency_grants (agency_id, claimed_at);

create table if not exists mission_rewards (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  mission_id uuid not null references missions(id) on delete cascade,
  contract_id uuid references agency_contracts(id) on delete set null,
  funding_usd bigint not null default 0 check (funding_usd >= 0),
  rp int not null default 0 check (rp >= 0),
  science_points numeric not null default 0 check (science_points >= 0),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPLIED')),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  unique (mission_id)
);

create index if not exists mission_rewards_agency_idx
  on mission_rewards (agency_id, created_at);

create table if not exists mission_queue (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  season_id uuid default current_season_id() references seasons(id) on delete cascade,
  name text not null,
  vehicle_id uuid not null references vehicles(id) on delete restrict,
  mission_type text not null
    check (mission_type in ('test', 'scientific', 'manned', 'colonial')),
  contract_id uuid references agency_contracts(id) on delete set null,
  contract_key text,
  target_inclination_deg numeric
    check (target_inclination_deg is null or target_inclination_deg between 0 and 180),
  azimuth_deg numeric
    check (azimuth_deg is null or azimuth_deg between 0 and 360),
  status text not null default 'QUEUED'
    check (status in ('QUEUED', 'ACTIVE', 'COMPLETED', 'FAILED', 'CANCELLED')),
  mission_id uuid references missions(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists mission_queue_agency_status_idx
  on mission_queue (agency_id, status, created_at);
create index if not exists mission_queue_mission_idx
  on mission_queue (mission_id);

alter table missions
  add column if not exists contract_id uuid
    references agency_contracts(id) on delete set null,
  add column if not exists queue_id uuid
    references mission_queue(id) on delete set null;

create index if not exists missions_contract_idx
  on missions (contract_id);

-- Atomic reward settlement. The unique mission_id guard makes event retries
-- idempotent even if the backend crashes after the payout.
create or replace function settle_mission_rewards(
  p_agency_id uuid,
  p_mission_id uuid,
  p_contract_id uuid,
  p_funding_usd bigint,
  p_rp int,
  p_science_points numeric,
  p_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reward_id uuid;
  agency_row agencies%rowtype;
begin
  if coalesce(p_funding_usd, 0) < 0
     or coalesce(p_rp, 0) < 0
     or coalesce(p_science_points, 0) < 0 then
    raise exception 'Mission reward amounts must be non-negative';
  end if;

  insert into mission_rewards (
    agency_id, mission_id, contract_id, funding_usd, rp, science_points, status
  )
  values (
    p_agency_id, p_mission_id, p_contract_id,
    coalesce(p_funding_usd, 0), coalesce(p_rp, 0), coalesce(p_science_points, 0),
    'PENDING'
  )
  on conflict (mission_id) do nothing
  returning id into reward_id;

  if reward_id is null then
    return jsonb_build_object('already_applied', true);
  end if;

  update agencies
  set funding_usd = coalesce(funding_usd, 0) + coalesce(p_funding_usd, 0),
      rp = coalesce(rp, 0) + coalesce(p_rp, 0),
      science_points = coalesce(science_points, 0) + coalesce(p_science_points, 0),
      updated_at = now()
  where id = p_agency_id
  returning * into agency_row;

  if agency_row.id is null then
    raise exception 'Agency % not found for mission reward', p_agency_id;
  end if;

  if p_contract_id is not null then
    update agency_contracts
    set status = 'COMPLETED',
        completed_at = coalesce(p_completed_at, now()),
        updated_at = now()
    where id = p_contract_id
      and agency_id = p_agency_id
      and status = 'ACTIVE';
  end if;

  update mission_rewards
  set status = 'APPLIED',
      applied_at = now()
  where id = reward_id;

  return jsonb_build_object(
    'already_applied', false,
    'funding_usd', agency_row.funding_usd,
    'rp', agency_row.rp,
    'science_points', agency_row.science_points
  );
end;
$$;

-- Atomic one-time grant claim.
create or replace function claim_agency_grant(
  p_agency_id uuid,
  p_grant_key text,
  p_funding_usd bigint,
  p_science_points numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claim_id uuid;
  agency_row agencies%rowtype;
begin
  if coalesce(p_funding_usd, 0) < 0 or coalesce(p_science_points, 0) < 0 then
    raise exception 'Grant amounts must be non-negative';
  end if;

  insert into agency_grants (
    agency_id, grant_key, amount_funding_usd, amount_science
  )
  values (
    p_agency_id, p_grant_key,
    coalesce(p_funding_usd, 0), coalesce(p_science_points, 0)
  )
  on conflict (agency_id, grant_key) do nothing
  returning id into claim_id;

  if claim_id is null then
    return jsonb_build_object('already_claimed', true);
  end if;

  update agencies
  set funding_usd = coalesce(funding_usd, 0) + coalesce(p_funding_usd, 0),
      science_points = coalesce(science_points, 0) + coalesce(p_science_points, 0),
      updated_at = now()
  where id = p_agency_id
  returning * into agency_row;

  if agency_row.id is null then
    raise exception 'Agency % not found for grant claim', p_agency_id;
  end if;

  return jsonb_build_object(
    'already_claimed', false,
    'funding_usd', agency_row.funding_usd,
    'science_points', agency_row.science_points
  );
end;
$$;

grant execute on function settle_mission_rewards(uuid, uuid, uuid, bigint, int, numeric, timestamptz)
  to service_role;
grant execute on function claim_agency_grant(uuid, text, bigint, numeric)
  to service_role;

-- ===== 009_economy_rls.sql =====

-- 009_economy_rls.sql
-- Economy rows are read-only for clients. All mutations stay behind the backend
-- service role, which bypasses RLS.

alter table agency_contracts enable row level security;
alter table agency_grants enable row level security;
alter table mission_rewards enable row level security;
alter table mission_queue enable row level security;

drop policy if exists agency_contracts_read_own on agency_contracts;
create policy agency_contracts_read_own on agency_contracts
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.user_id = auth.uid()
        and a.id = agency_contracts.agency_id
    )
  );

drop policy if exists agency_grants_read_own on agency_grants;
create policy agency_grants_read_own on agency_grants
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.user_id = auth.uid()
        and a.id = agency_grants.agency_id
    )
  );

drop policy if exists mission_rewards_read_own on mission_rewards;
create policy mission_rewards_read_own on mission_rewards
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.user_id = auth.uid()
        and a.id = mission_rewards.agency_id
    )
  );

drop policy if exists mission_queue_read_own on mission_queue;
create policy mission_queue_read_own on mission_queue
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.user_id = auth.uid()
        and a.id = mission_queue.agency_id
    )
  );

grant select on
  agency_contracts,
  agency_grants,
  mission_rewards,
  mission_queue
to authenticated;

-- ===== 010_contract_mission_link.sql =====

-- Keep the contract -> mission link populated when rewards settle, and backfill
-- contracts that completed before this migration.
create or replace function settle_mission_rewards(
  p_agency_id uuid,
  p_mission_id uuid,
  p_contract_id uuid,
  p_funding_usd bigint,
  p_rp int,
  p_science_points numeric,
  p_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reward_id uuid;
  agency_row agencies%rowtype;
begin
  if coalesce(p_funding_usd, 0) < 0
     or coalesce(p_rp, 0) < 0
     or coalesce(p_science_points, 0) < 0 then
    raise exception 'Mission reward amounts must be non-negative';
  end if;

  insert into mission_rewards (
    agency_id, mission_id, contract_id, funding_usd, rp, science_points, status
  )
  values (
    p_agency_id, p_mission_id, p_contract_id,
    coalesce(p_funding_usd, 0), coalesce(p_rp, 0), coalesce(p_science_points, 0),
    'PENDING'
  )
  on conflict (mission_id) do nothing
  returning id into reward_id;

  if reward_id is null then
    return jsonb_build_object('already_applied', true);
  end if;

  update agencies
  set funding_usd = coalesce(funding_usd, 0) + coalesce(p_funding_usd, 0),
      rp = coalesce(rp, 0) + coalesce(p_rp, 0),
      science_points = coalesce(science_points, 0) + coalesce(p_science_points, 0),
      updated_at = now()
  where id = p_agency_id
  returning * into agency_row;

  if agency_row.id is null then
    raise exception 'Agency % not found for mission reward', p_agency_id;
  end if;

  if p_contract_id is not null then
    update agency_contracts
    set status = 'COMPLETED',
        mission_id = p_mission_id,
        completed_at = coalesce(p_completed_at, now()),
        updated_at = now()
    where id = p_contract_id
      and agency_id = p_agency_id
      and status = 'ACTIVE';
  end if;

  update mission_rewards
  set status = 'APPLIED',
      applied_at = now()
  where id = reward_id;

  return jsonb_build_object(
    'already_applied', false,
    'funding_usd', agency_row.funding_usd,
    'rp', agency_row.rp,
    'science_points', agency_row.science_points
  );
end;
$$;

grant execute on function settle_mission_rewards(uuid, uuid, uuid, bigint, int, numeric, timestamptz)
  to service_role;

update agency_contracts as contract
set mission_id = mission.id,
    updated_at = now()
from missions as mission
where mission.contract_id = contract.id
  and contract.mission_id is null;

-- ===== 011_audit_events.sql =====

-- Audit trail for GM actions and financial mutations.
-- Service-role only: RLS is enabled without client policies.

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references seasons(id) on delete set null,
  agency_id uuid references agencies(id) on delete set null,
  actor_type text not null
    check (actor_type in ('gm', 'player', 'agency', 'system')),
  actor_id text,
  action text not null,
  entity_type text,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  delta_data jsonb,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_agency_created_idx
  on audit_events (agency_id, created_at desc);

create index if not exists audit_events_action_created_idx
  on audit_events (action, created_at desc);

create index if not exists audit_events_actor_created_idx
  on audit_events (actor_type, created_at desc);

create index if not exists audit_events_created_idx
  on audit_events (created_at desc);

alter table audit_events enable row level security;

comment on table audit_events is
  'Append-only audit trail for GM actions and financial mutations. Backend service role only.';

-- ===== 012_audit_append_only.sql =====

-- Enforce append-only audit rows.
-- The 011 foreign keys used ON DELETE SET NULL, which would mutate audit rows
-- when an agency or season is deleted. Keep them as soft references instead.

alter table audit_events drop constraint if exists audit_events_agency_id_fkey;
alter table audit_events drop constraint if exists audit_events_season_id_fkey;

create or replace function audit_events_reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events is append-only; % is not allowed', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists audit_events_no_update on audit_events;
create trigger audit_events_no_update
  before update on audit_events
  for each row execute function audit_events_reject_mutation();

drop trigger if exists audit_events_no_delete on audit_events;
create trigger audit_events_no_delete
  before delete on audit_events
  for each row execute function audit_events_reject_mutation();

drop trigger if exists audit_events_no_truncate on audit_events;
create trigger audit_events_no_truncate
  before truncate on audit_events
  for each statement execute function audit_events_reject_mutation();

comment on function audit_events_reject_mutation() is
  'Blocks UPDATE, DELETE, and TRUNCATE on audit_events. Drop triggers only for an intentional maintenance window.';

-- ===== 013_mission_feasibility.sql =====

-- 013_mission_feasibility.sql
-- Vehicle performance envelope for the deterministic mission feasibility planner.
-- Additive and safe to re-run. Apply only with owner approval on shared projects.

alter table vehicles
  add column if not exists vehicle_class text,
  add column if not exists dry_mass_kg numeric,
  add column if not exists propellant_mass_kg numeric,
  add column if not exists payload_capacity_kg numeric,
  add column if not exists delta_v_budget_m_s numeric,
  add column if not exists crew_capacity int,
  add column if not exists performance_note text;

update vehicles
set
  vehicle_class = coalesce(vehicle_class, case type
    when 'sounding-rocket' then 'suborbital'
    when 'orbital-rocket' then 'orbital'
    when 'satellite' then 'orbital-payload'
    when 'capsule' then 'crewed'
    when 'probe' then 'deep-space'
    when 'lander' then 'deep-space'
  end),
  dry_mass_kg = coalesce(dry_mass_kg, case type
    when 'sounding-rocket' then 1200
    when 'orbital-rocket' then 12000
    when 'satellite' then 800
    when 'capsule' then 3500
    when 'probe' then 1000
    when 'lander' then 6000
  end),
  propellant_mass_kg = coalesce(propellant_mass_kg, case type
    when 'sounding-rocket' then 9800
    when 'orbital-rocket' then 130000
    when 'satellite' then 600
    when 'capsule' then 1500
    when 'probe' then 1400
    when 'lander' then 11000
  end),
  payload_capacity_kg = coalesce(payload_capacity_kg, case type
    when 'sounding-rocket' then 150
    when 'orbital-rocket' then 4500
    when 'satellite' then 700
    when 'capsule' then 1500
    when 'probe' then 900
    when 'lander' then 3000
  end),
  delta_v_budget_m_s = coalesce(delta_v_budget_m_s, case type
    when 'sounding-rocket' then 2100
    when 'orbital-rocket' then 9450
    when 'satellite' then 3800
    when 'capsule' then 4200
    when 'probe' then 4200
    when 'lander' then 5800
  end),
  crew_capacity = coalesce(crew_capacity, case type
    when 'capsule' then 3
    when 'lander' then 2
    else 0
  end)
where type in (
  'sounding-rocket',
  'orbital-rocket',
  'satellite',
  'capsule',
  'probe',
  'lander'
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vehicles_class_check'
  ) then
    alter table vehicles
      add constraint vehicles_class_check
      check (
        vehicle_class is null
        or vehicle_class in ('suborbital', 'orbital', 'orbital-payload', 'crewed', 'deep-space')
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'vehicles_performance_nonnegative_check'
  ) then
    alter table vehicles
      add constraint vehicles_performance_nonnegative_check
      check (
        (dry_mass_kg is null or dry_mass_kg >= 0)
        and (propellant_mass_kg is null or propellant_mass_kg >= 0)
        and (payload_capacity_kg is null or payload_capacity_kg >= 0)
        and (delta_v_budget_m_s is null or delta_v_budget_m_s >= 0)
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'vehicles_crew_capacity_check'
  ) then
    alter table vehicles
      add constraint vehicles_crew_capacity_check
      check (crew_capacity is null or crew_capacity between 0 and 20);
  end if;
end
$$;

create or replace function vehicles_apply_performance_defaults()
returns trigger
language plpgsql
as $$
begin
  if new.vehicle_class is null then
    new.vehicle_class := case new.type
      when 'sounding-rocket' then 'suborbital'
      when 'orbital-rocket' then 'orbital'
      when 'satellite' then 'orbital-payload'
      when 'capsule' then 'crewed'
      when 'probe' then 'deep-space'
      when 'lander' then 'deep-space'
    end;
  end if;

  if new.dry_mass_kg is null then
    new.dry_mass_kg := case new.type
      when 'sounding-rocket' then 1200
      when 'orbital-rocket' then 12000
      when 'satellite' then 800
      when 'capsule' then 3500
      when 'probe' then 1000
      when 'lander' then 6000
    end;
  end if;

  if new.propellant_mass_kg is null then
    new.propellant_mass_kg := case new.type
      when 'sounding-rocket' then 9800
      when 'orbital-rocket' then 130000
      when 'satellite' then 600
      when 'capsule' then 1500
      when 'probe' then 1400
      when 'lander' then 11000
    end;
  end if;

  if new.payload_capacity_kg is null then
    new.payload_capacity_kg := case new.type
      when 'sounding-rocket' then 150
      when 'orbital-rocket' then 4500
      when 'satellite' then 700
      when 'capsule' then 1500
      when 'probe' then 900
      when 'lander' then 3000
    end;
  end if;

  if new.delta_v_budget_m_s is null then
    new.delta_v_budget_m_s := case new.type
      when 'sounding-rocket' then 2100
      when 'orbital-rocket' then 9450
      when 'satellite' then 3800
      when 'capsule' then 4200
      when 'probe' then 4200
      when 'lander' then 5800
    end;
  end if;

  if new.crew_capacity is null then
    new.crew_capacity := case new.type
      when 'capsule' then 3
      when 'lander' then 2
      else 0
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists vehicles_apply_performance_defaults on vehicles;
create trigger vehicles_apply_performance_defaults
  before insert or update on vehicles
  for each row execute function vehicles_apply_performance_defaults();

comment on column vehicles.vehicle_class is
  'Coarse launch/operational class used by mission feasibility checks.';
comment on column vehicles.dry_mass_kg is
  'Dry mass in kilograms, excluding propellant and payload.';
comment on column vehicles.propellant_mass_kg is
  'Usable propellant mass in kilograms for the vehicle profile.';
comment on column vehicles.payload_capacity_kg is
  'Maximum mission payload mass in kilograms.';
comment on column vehicles.delta_v_budget_m_s is
  'Abstract mission delta-v budget in metres per second, including launch and orbital manoeuvres.';
comment on column vehicles.crew_capacity is
  'Maximum crew seats available for a crewed mission profile.';
comment on function vehicles_apply_performance_defaults() is
  'Fills null vehicle performance fields from the built-in type profile on insert/update.';

-- ===== 014_annual_budget.sql =====

-- 014_annual_budget.sql
-- Annual operating budget reviews, vehicle upkeep, and the settlement ledger.
-- Additive and safe to re-run. Apply only with owner approval on shared projects.

create table if not exists agency_budget_cycles (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  season_id uuid not null references seasons(id) on delete cascade,
  cycle_year int not null check (cycle_year between 1900 and 3000),
  game_date date not null,
  settled_at timestamptz not null default now(),
  appropriation_usd bigint not null check (appropriation_usd >= 0),
  operating_cost_usd bigint not null check (operating_cost_usd >= 0),
  upkeep_usd bigint not null check (upkeep_usd >= 0),
  total_cost_usd bigint not null check (total_cost_usd >= 0),
  net_usd bigint not null,
  funding_before_usd bigint not null check (funding_before_usd >= 0),
  funding_after_usd bigint not null check (funding_after_usd >= 0),
  unpaid_usd bigint not null default 0 check (unpaid_usd >= 0),
  status text not null default 'APPLIED'
    check (status in ('APPLIED', 'DEFICIT')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (agency_id, season_id, cycle_year)
);

create index if not exists agency_budget_cycles_agency_idx
  on agency_budget_cycles (agency_id, settled_at desc);
create index if not exists agency_budget_cycles_season_idx
  on agency_budget_cycles (season_id, cycle_year);

alter table agency_budget_cycles enable row level security;

drop policy if exists agency_budget_cycles_read_own on agency_budget_cycles;
create policy agency_budget_cycles_read_own on agency_budget_cycles
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.user_id = auth.uid()
        and a.id = agency_budget_cycles.agency_id
    )
  );

grant select on agency_budget_cycles to authenticated;

-- Atomic annual settlement. The unique cycle guard keeps worker retries
-- idempotent; funding can never go below zero, and any shortfall is recorded
-- as unpaid_usd with a DEFICIT status.
create or replace function settle_annual_budget(
  p_agency_id uuid,
  p_season_id uuid,
  p_cycle_year int,
  p_game_date date,
  p_appropriation_usd bigint,
  p_operating_cost_usd bigint,
  p_upkeep_usd bigint,
  p_details jsonb,
  p_settled_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cycle_id uuid;
  agency_row agencies%rowtype;
  total_cost bigint;
  net_amount bigint;
  funding_before bigint;
  funding_after bigint;
  unpaid bigint;
  cycle_status text;
begin
  if coalesce(p_appropriation_usd, 0) < 0
     or coalesce(p_operating_cost_usd, 0) < 0
     or coalesce(p_upkeep_usd, 0) < 0 then
    raise exception 'Annual budget amounts must be non-negative';
  end if;

  select * into agency_row
  from agencies
  where id = p_agency_id
  for update;

  if agency_row.id is null then
    raise exception 'Agency % not found for annual budget', p_agency_id;
  end if;

  total_cost := coalesce(p_operating_cost_usd, 0) + coalesce(p_upkeep_usd, 0);
  net_amount := coalesce(p_appropriation_usd, 0) - total_cost;
  funding_before := coalesce(agency_row.funding_usd, 0);
  funding_after := greatest(0, funding_before + net_amount);
  unpaid := greatest(0, -(funding_before + net_amount));
  cycle_status := case when unpaid > 0 then 'DEFICIT' else 'APPLIED' end;

  insert into agency_budget_cycles (
    agency_id,
    season_id,
    cycle_year,
    game_date,
    settled_at,
    appropriation_usd,
    operating_cost_usd,
    upkeep_usd,
    total_cost_usd,
    net_usd,
    funding_before_usd,
    funding_after_usd,
    unpaid_usd,
    status,
    details
  )
  values (
    p_agency_id,
    p_season_id,
    p_cycle_year,
    p_game_date,
    coalesce(p_settled_at, now()),
    coalesce(p_appropriation_usd, 0),
    coalesce(p_operating_cost_usd, 0),
    coalesce(p_upkeep_usd, 0),
    total_cost,
    net_amount,
    funding_before,
    funding_after,
    unpaid,
    cycle_status,
    coalesce(p_details, '{}'::jsonb)
  )
  on conflict (agency_id, season_id, cycle_year) do nothing
  returning id into cycle_id;

  if cycle_id is null then
    return jsonb_build_object('already_applied', true);
  end if;

  update agencies
  set funding_usd = funding_after,
      updated_at = now()
  where id = p_agency_id;

  return jsonb_build_object(
    'already_applied', false,
    'cycle_id', cycle_id,
    'funding_before_usd', funding_before,
    'funding_after_usd', funding_after,
    'appropriation_usd', coalesce(p_appropriation_usd, 0),
    'operating_cost_usd', coalesce(p_operating_cost_usd, 0),
    'upkeep_usd', coalesce(p_upkeep_usd, 0),
    'total_cost_usd', total_cost,
    'net_usd', net_amount,
    'unpaid_usd', unpaid,
    'status', cycle_status
  );
end;
$$;

revoke all on function settle_annual_budget(
  uuid, uuid, int, date, bigint, bigint, bigint, jsonb, timestamptz
) from public, anon, authenticated;

grant execute on function settle_annual_budget(
  uuid, uuid, int, date, bigint, bigint, bigint, jsonb, timestamptz
) to service_role;

-- ===== 015_personnel_investigations.sql =====

-- 015_personnel_investigations.sql
-- Agency crew roster, mission crew assignments, and mishap investigations.
-- Additive and safe to re-run. Apply only with owner approval on shared projects.

create table if not exists agency_crew (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 40),
  role text not null default 'MISSION_SPECIALIST'
    check (role in ('COMMANDER', 'PILOT', 'MISSION_SPECIALIST')),
  status text not null default 'TRAINING'
    check (status in ('TRAINING', 'ACTIVE', 'INJURED', 'KILLED', 'RETIRED')),
  experience int not null default 0 check (experience >= 0),
  missions_flown int not null default 0 check (missions_flown >= 0),
  salary_usd bigint not null default 110000 check (salary_usd >= 0),
  training_cost_usd bigint not null default 250000 check (training_cost_usd >= 0),
  hired_at timestamptz not null default now(),
  ready_at timestamptz,
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, name)
);

create index if not exists agency_crew_agency_status_idx
  on agency_crew (agency_id, status, hired_at);

create table if not exists mission_crew (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references missions(id) on delete cascade,
  crew_id uuid not null references agency_crew(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  role text not null check (role in ('COMMANDER', 'PILOT', 'MISSION_SPECIALIST')),
  outcome text not null default 'ASSIGNED'
    check (outcome in ('ASSIGNED', 'SURVIVED', 'KILLED')),
  created_at timestamptz not null default now(),
  unique (mission_id, crew_id)
);

create index if not exists mission_crew_mission_idx
  on mission_crew (mission_id);
create index if not exists mission_crew_crew_idx
  on mission_crew (crew_id, created_at desc);

create table if not exists mission_investigations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  mission_id uuid not null references missions(id) on delete cascade,
  season_id uuid references seasons(id) on delete set null,
  mission_name text,
  stage text not null check (stage in ('LAUNCH', 'ORBIT_INSERTION', 'ORBIT_OPERATIONS')),
  status text not null default 'OPEN'
    check (status in ('OPEN', 'IN_PROGRESS', 'COMPLETED')),
  cause text,
  findings text,
  cost_usd bigint not null default 0 check (cost_usd >= 0),
  reliability_bonus int not null default 0 check (reliability_bonus between 0 and 10),
  started_at timestamptz,
  completes_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (mission_id)
);

create index if not exists mission_investigations_agency_idx
  on mission_investigations (agency_id, created_at desc);

drop trigger if exists agency_crew_set_updated_at on agency_crew;
create trigger agency_crew_set_updated_at
  before update on agency_crew
  for each row execute function set_updated_at();

alter table agency_crew enable row level security;
alter table mission_crew enable row level security;
alter table mission_investigations enable row level security;

drop policy if exists agency_crew_read_own on agency_crew;
create policy agency_crew_read_own on agency_crew
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.user_id = auth.uid()
        and a.id = agency_crew.agency_id
    )
  );

drop policy if exists mission_crew_read_own on mission_crew;
create policy mission_crew_read_own on mission_crew
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.user_id = auth.uid()
        and a.id = mission_crew.agency_id
    )
  );

drop policy if exists mission_investigations_read_own on mission_investigations;
create policy mission_investigations_read_own on mission_investigations
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.user_id = auth.uid()
        and a.id = mission_investigations.agency_id
    )
  );

grant select on
  agency_crew,
  mission_crew,
  mission_investigations
to authenticated;

comment on table agency_crew is
  'Agency astronaut roster with payroll, training status, and flight history.';
comment on table mission_crew is
  'Crew assignments per mission and their survival outcome.';
comment on table mission_investigations is
  'Post-failure investigations that restore launch vehicle reliability.';
