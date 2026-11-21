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

function economyRpc(database) {
  return {
    settle_mission_rewards: (params) => settleMissionRewards(params, database),
    claim_agency_grant: (params) => claimAgencyGrant(params, database),
  };
}

module.exports = { economyRpc };
