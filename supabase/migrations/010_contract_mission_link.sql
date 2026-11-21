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
