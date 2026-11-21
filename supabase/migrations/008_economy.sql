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
