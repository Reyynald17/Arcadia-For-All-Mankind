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
