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
