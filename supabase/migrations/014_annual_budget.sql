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
