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
