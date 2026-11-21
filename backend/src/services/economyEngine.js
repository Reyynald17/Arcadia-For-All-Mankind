const { recordAuditEvent } = require('./auditLog');

const MISSION_TYPES = new Set(['test', 'scientific', 'manned', 'colonial']);

const MISSION_BASE_REWARDS = Object.freeze({
  test: 200000,
  scientific: 750000,
  manned: 2000000,
  colonial: 4000000,
});

const CONTRACT_CATALOG = Object.freeze([
  {
    key: 'ATMOSPHERIC_SOUNDING',
    name: 'Atmospheric Sounding Data',
    description: 'Deliver a successful sounding mission with usable upper-atmosphere telemetry.',
    missionType: 'test',
    requirement: null,
    reward: { funding_usd: 900000, rp: 4, science_points: 10 },
  },
  {
    key: 'ORBITAL_WEATHER_NETWORK',
    name: 'Orbital Weather Network',
    description: 'Place a scientific payload in orbit and complete its operations phase.',
    missionType: 'scientific',
    requirement: { label: '1 total launch', test: (agency) => Number(agency.total_launches || 0) >= 1 },
    reward: { funding_usd: 3500000, rp: 8, science_points: 30 },
  },
  {
    key: 'CREWED_ENDURANCE_PROGRAM',
    name: 'Crewed Endurance Program',
    description: 'Fly a manned mission to orbit and return a complete mission report.',
    missionType: 'manned',
    requirement: { label: '1 successful launch', test: (agency) => Number(agency.successful_launches || 0) >= 1 },
    reward: { funding_usd: 9000000, rp: 16, science_points: 60 },
  },
  {
    key: 'LUNAR_PRECURSOR_SURVEY',
    name: 'Lunar Precursor Survey',
    description: 'Run a colonial-class mission and validate the deep-space flight profile.',
    missionType: 'colonial',
    requirement: { label: '2 successful launches', test: (agency) => Number(agency.successful_launches || 0) >= 2 },
    reward: { funding_usd: 18000000, rp: 28, science_points: 120 },
  },
]);

const GRANT_CATALOG = Object.freeze([
  {
    key: 'STARTUP_CAPITAL',
    name: 'Startup Capital',
    description: 'Founding allocation for a newly registered agency.',
    requirement: null,
    reward: { funding_usd: 2000000, science_points: 0 },
  },
  {
    key: 'RESEARCH_INFUSION',
    name: 'Research Infusion',
    description: 'Unlocked after the agency completes its first launch campaign.',
    requirement: { label: '1 total launch', test: (agency) => Number(agency.total_launches || 0) >= 1 },
    reward: { funding_usd: 1500000, science_points: 15 },
  },
  {
    key: 'ORBITAL_RELIEF',
    name: 'Orbital Reliability Fund',
    description: 'Unlocked after the agency records a successful launch.',
    requirement: { label: '1 successful launch', test: (agency) => Number(agency.successful_launches || 0) >= 1 },
    reward: { funding_usd: 4000000, science_points: 25 },
  },
]);

class EconomyError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'EconomyError';
    this.status = status;
  }
}

function getContract(key) {
  return CONTRACT_CATALOG.find((contract) => contract.key === key) || null;
}

function getGrant(key) {
  return GRANT_CATALOG.find((grant) => grant.key === key) || null;
}

function missionBaseReward(missionType) {
  return MISSION_BASE_REWARDS[missionType] || 0;
}

function requirementMet(requirement, agency) {
  return !requirement || requirement.test(agency);
}

function requirementLabel(requirement) {
  return requirement?.label || null;
}

function publicContract(contract, agency) {
  return {
    key: contract.key,
    name: contract.name,
    description: contract.description,
    mission_type: contract.missionType,
    requirement: requirementLabel(contract.requirement),
    eligible: requirementMet(contract.requirement, agency),
    reward: { ...contract.reward },
  };
}

function publicGrant(grant, agency) {
  return {
    key: grant.key,
    name: grant.name,
    description: grant.description,
    requirement: requirementLabel(grant.requirement),
    eligible: requirementMet(grant.requirement, agency),
    reward: { ...grant.reward },
  };
}

async function resolveContractForMission(supabase, {
  agencyId,
  contractId,
  contractKey,
  missionType,
}) {
  if (!contractId && !contractKey) return null;

  let query = supabase.from('agency_contracts').select('*');
  query = contractId
    ? query.eq('id', contractId)
    : query.eq('agency_id', agencyId).eq('contract_key', contractKey);

  const { data: contract, error } = await query.maybeSingle();
  if (error) {
    if (String(error.message || '').includes('does not exist')) {
      throw new EconomyError(503, 'Economy migration is not applied yet');
    }
    throw new Error(`contract lookup: ${error.message}`);
  }
  if (!contract) throw new EconomyError(404, 'Contract not found for this agency');
  if (contract.status !== 'ACTIVE') {
    throw new EconomyError(400, `Contract is ${contract.status.toLowerCase()}, not ACTIVE`);
  }

  const definition = getContract(contract.contract_key);
  if (!definition) throw new EconomyError(400, `Unknown contract: ${contract.contract_key}`);
  if (definition.missionType !== missionType) {
    throw new EconomyError(
      400,
      `Contract ${definition.name} requires a ${definition.missionType} mission`,
    );
  }

  return contract;
}

async function settleMissionRewards(supabase, mission, { completedAt } = {}) {
  if (!mission?.id || !mission?.agency_id) {
    throw new Error('Mission reward requires mission id and agency');
  }
  if (mission.result !== 'success' && mission.status !== 'COMPLETED') {
    return { skipped: true, reason: 'MISSION_NOT_SUCCESSFUL' };
  }

  let contract = null;
  let definition = null;
  if (mission.contract_id) {
    const { data, error } = await supabase
      .from('agency_contracts')
      .select('*')
      .eq('id', mission.contract_id)
      .maybeSingle();
    if (error) throw new Error(`mission reward contract: ${error.message}`);
    contract = data && data.status === 'ACTIVE' ? data : null;
    if (contract) {
      definition = getContract(contract.contract_key);
      if (definition && definition.missionType !== mission.type) {
        contract = null;
        definition = null;
      }
    }
  }

  const baseFunding = missionBaseReward(mission.type);
  const contractFunding = contract ? Number(contract.payout_funding_usd || 0) : 0;
  const contractRp = contract ? Number(contract.reward_rp || 0) : 0;
  const contractScience = contract ? Number(contract.reward_science || 0) : 0;
  const fundingUsd = baseFunding + contractFunding;
  const rp = contractRp;
  const sciencePoints = contractScience;

  if (fundingUsd === 0 && rp === 0 && sciencePoints === 0) {
    return { skipped: true, reason: 'NO_REWARD' };
  }

  const rewardTime = completedAt || mission.completed_at || new Date().toISOString();
  const { data: result, error: rpcError } = await supabase.rpc('settle_mission_rewards', {
    p_agency_id: mission.agency_id,
    p_mission_id: mission.id,
    p_contract_id: contract?.id || null,
    p_funding_usd: fundingUsd,
    p_rp: rp,
    p_science_points: sciencePoints,
    p_completed_at: rewardTime,
  });

  if (rpcError) {
    if (String(rpcError.message || '').includes('does not exist')) {
      throw new Error('Economy migration is not applied yet');
    }
    throw new Error(`mission reward settlement: ${rpcError.message}`);
  }

  if (result?.already_applied) {
    return { already_applied: true };
  }

  const { error: logError } = await supabase
    .from('logs')
    .insert([{
      agency_id: mission.agency_id,
      event_type: 'MISSION_REWARDED',
      description: `Mission reward paid: ${mission.name}`,
      data: {
        mission_id: mission.id,
        mission_name: mission.name,
        mission_type: mission.type,
        contract_id: contract?.id || null,
        contract_key: contract?.contract_key || null,
        contract_name: definition?.name || null,
        base_funding_usd: baseFunding,
        contract_funding_usd: contractFunding,
        funding_usd: fundingUsd,
        rp,
        science_points: sciencePoints,
        completed_at: rewardTime,
      },
    }]);

  if (logError) throw new Error(`mission reward log: ${logError.message}`);

  await recordAuditEvent(supabase, {
    actorType: 'system',
    actorId: 'mission_rewards',
    agencyId: mission.agency_id,
    action: 'MISSION_REWARDED',
    entityType: 'mission',
    entityId: mission.id,
    afterData: {
      funding_usd: result?.funding_usd ?? null,
      rp: result?.rp ?? null,
      science_points: result?.science_points ?? null,
    },
    deltaData: {
      funding_usd: fundingUsd,
      rp,
      science_points: sciencePoints,
    },
    metadata: {
      mission_name: mission.name,
      mission_type: mission.type,
      contract_id: contract?.id || null,
      contract_key: contract?.contract_key || null,
    },
  });

  return {
    funding_usd: fundingUsd,
    rp,
    science_points: sciencePoints,
    contract_id: contract?.id || null,
    contract_key: contract?.contract_key || null,
    new_stats: {
      funding_usd: result?.funding_usd,
      rp: result?.rp,
      science_points: result?.science_points,
    },
  };
}

module.exports = {
  MISSION_TYPES,
  MISSION_BASE_REWARDS,
  CONTRACT_CATALOG,
  GRANT_CATALOG,
  EconomyError,
  getContract,
  getGrant,
  missionBaseReward,
  requirementMet,
  requirementLabel,
  publicContract,
  publicGrant,
  resolveContractForMission,
  settleMissionRewards,
};
