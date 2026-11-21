function settleMissionRewards(params, database) {
  const rewards = database.mission_rewards || (database.mission_rewards = []);
  if (rewards.some((row) => row.mission_id === params.p_mission_id)) {
    return { already_applied: true };
  }

  const agency = (database.agencies || []).find((row) => row.id === params.p_agency_id);
  if (!agency) throw new Error(`Agency ${params.p_agency_id} not found for mission reward`);

  agency.funding_usd = Number(agency.funding_usd || 0) + Number(params.p_funding_usd || 0);
  agency.rp = Number(agency.rp || 0) + Number(params.p_rp || 0);
  agency.science_points = Number(agency.science_points || 0) + Number(params.p_science_points || 0);

  if (params.p_contract_id) {
    const contract = (database.agency_contracts || []).find((row) => row.id === params.p_contract_id);
    if (contract && contract.status === 'ACTIVE') {
      contract.status = 'COMPLETED';
      contract.completed_at = params.p_completed_at;
    }
  }

  rewards.push({
    id: `reward-${rewards.length + 1}`,
    agency_id: params.p_agency_id,
    mission_id: params.p_mission_id,
    contract_id: params.p_contract_id || null,
    funding_usd: Number(params.p_funding_usd || 0),
    rp: Number(params.p_rp || 0),
    science_points: Number(params.p_science_points || 0),
    status: 'APPLIED',
    applied_at: params.p_completed_at,
  });

  return {
    already_applied: false,
    funding_usd: agency.funding_usd,
    rp: agency.rp,
    science_points: agency.science_points,
  };
}

function claimAgencyGrant(params, database) {
  const grants = database.agency_grants || (database.agency_grants = []);
  if (grants.some((row) => row.agency_id === params.p_agency_id && row.grant_key === params.p_grant_key)) {
    return { already_claimed: true };
  }

  const agency = (database.agencies || []).find((row) => row.id === params.p_agency_id);
  if (!agency) throw new Error(`Agency ${params.p_agency_id} not found for grant claim`);

  agency.funding_usd = Number(agency.funding_usd || 0) + Number(params.p_funding_usd || 0);
  agency.science_points = Number(agency.science_points || 0) + Number(params.p_science_points || 0);

  grants.push({
    id: `grant-${grants.length + 1}`,
    agency_id: params.p_agency_id,
    grant_key: params.p_grant_key,
    amount_funding_usd: Number(params.p_funding_usd || 0),
    amount_science: Number(params.p_science_points || 0),
    claimed_at: new Date().toISOString(),
  });

  return {
    already_claimed: false,
    funding_usd: agency.funding_usd,
    science_points: agency.science_points,
  };
}

function settleAnnualBudget(params, database) {
  const cycles = database.agency_budget_cycles || (database.agency_budget_cycles = []);
  const existing = cycles.find((row) =>
    row.agency_id === params.p_agency_id
    && row.season_id === params.p_season_id
    && Number(row.cycle_year) === Number(params.p_cycle_year));

  if (existing) return { already_applied: true };

  const agency = (database.agencies || []).find((row) => row.id === params.p_agency_id);
  if (!agency) throw new Error(`Agency ${params.p_agency_id} not found for annual budget`);

  const appropriation = Number(params.p_appropriation_usd || 0);
  const operatingCost = Number(params.p_operating_cost_usd || 0);
  const upkeep = Number(params.p_upkeep_usd || 0);
  const totalCost = operatingCost + upkeep;
  const net = appropriation - totalCost;
  const fundingBefore = Number(agency.funding_usd || 0);
  const rawAfter = fundingBefore + net;
  const fundingAfter = Math.max(0, rawAfter);
  const unpaid = Math.max(0, -rawAfter);
  const status = unpaid > 0 ? 'DEFICIT' : 'APPLIED';

  agency.funding_usd = fundingAfter;

  cycles.push({
    id: `budget-${cycles.length + 1}`,
    agency_id: params.p_agency_id,
    season_id: params.p_season_id,
    cycle_year: Number(params.p_cycle_year),
    game_date: params.p_game_date,
    settled_at: params.p_settled_at,
    appropriation_usd: appropriation,
    operating_cost_usd: operatingCost,
    upkeep_usd: upkeep,
    total_cost_usd: totalCost,
    net_usd: net,
    funding_before_usd: fundingBefore,
    funding_after_usd: fundingAfter,
    unpaid_usd: unpaid,
    status,
    details: params.p_details || {},
  });

  return {
    already_applied: false,
    cycle_id: `budget-${cycles.length}`,
    funding_before_usd: fundingBefore,
    funding_after_usd: fundingAfter,
    appropriation_usd: appropriation,
    operating_cost_usd: operatingCost,
    upkeep_usd: upkeep,
    total_cost_usd: totalCost,
    net_usd: net,
    unpaid_usd: unpaid,
    status,
  };
}

function economyRpc(database) {
  return {
    settle_mission_rewards: (params) => settleMissionRewards(params, database),
    claim_agency_grant: (params) => claimAgencyGrant(params, database),
    settle_annual_budget: (params) => settleAnnualBudget(params, database),
  };
}

module.exports = { economyRpc };
