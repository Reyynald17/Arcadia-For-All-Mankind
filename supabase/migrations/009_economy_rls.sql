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
