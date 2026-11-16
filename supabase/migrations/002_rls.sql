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
