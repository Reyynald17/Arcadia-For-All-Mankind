const AGMEngine = require('./agm');

const INSERTION_BASE_PROBABILITY = Object.freeze({
  scientific: 0.94,
  manned: 0.92,
  colonial: 0.9,
});

const OPERATIONS_BASE_PROBABILITY = Object.freeze({
  scientific: 0.95,
  manned: 0.91,
  colonial: 0.89,
});

const MIN_PROBABILITY = 0.5;
const MAX_PROBABILITY = 0.995;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 3) {
  return Number(Number(value).toFixed(digits));
}

function reliabilityOf(vehicle) {
  const value = Number(vehicle?.reliability);
  return Number.isFinite(value) ? clamp(value, 0, 100) : 70;
}

function marginAdjustment(feasibility) {
  const marginPct = Number(feasibility?.delta_v_margin_pct);
  if (!Number.isFinite(marginPct)) return 0;
  if (marginPct < 5) return -0.04;
  if (marginPct >= 25) return 0.02;
  return 0;
}

function insertionProbability({ missionType, vehicle, feasibility } = {}) {
  const base = INSERTION_BASE_PROBABILITY[missionType];
  if (!base) return 1;
  const reliabilityBonus = (reliabilityOf(vehicle) - 70) * 0.001;
  return round(clamp(
    base + reliabilityBonus + marginAdjustment(feasibility),
    MIN_PROBABILITY,
    MAX_PROBABILITY,
  ));
}

function operationsProbability({
  missionType,
  vehicle,
  feasibility,
  crewExperience = 0,
} = {}) {
  const base = OPERATIONS_BASE_PROBABILITY[missionType];
  if (!base) return 1;
  const reliabilityBonus = (reliabilityOf(vehicle) - 70) * 0.0008;
  const experienceBonus = missionType === 'manned'
    ? Math.min(0.06, Math.max(0, Number(crewExperience) || 0) * 0.01)
    : 0;
  return round(clamp(
    base + reliabilityBonus + marginAdjustment(feasibility) + experienceBonus,
    MIN_PROBABILITY,
    MAX_PROBABILITY,
  ));
}

function simulateStagedLaunch({
  agency,
  vehicle,
  missionType,
  rng,
  feasibility = null,
} = {}) {
  const launch = AGMEngine.simulateMission(agency, vehicle, missionType, rng);
  const probability = insertionProbability({ missionType, vehicle, feasibility });
  const insertion = {
    stage: 'ORBIT_INSERTION',
    probability,
    success: true,
    roll: null,
  };

  if (probability < 1) {
    const roll = rng();
    insertion.success = roll < probability;
    insertion.roll = round(roll);
  }

  const stages = [
    {
      stage: 'LAUNCH',
      success: launch.success,
      score: launch.finalScore,
      probability: null,
      roll: null,
    },
    insertion,
  ];

  if (!launch.success) {
    return {
      ...launch,
      crewDeaths: launch.crewDeaths || 0,
      failed_stage: 'LAUNCH',
      stages,
    };
  }

  if (!insertion.success) {
    const crewDeaths = missionType === 'manned' && rng() < 0.5 ? 1 : 0;
    return {
      success: false,
      finalScore: launch.finalScore,
      rpGain: 0,
      scienceGain: Math.round((launch.scienceGain || 0) * 0.1),
      ipiChange: -8,
      siChange: -4,
      crewDeaths,
      failed_stage: 'ORBIT_INSERTION',
      stages,
    };
  }

  return {
    ...launch,
    failed_stage: null,
    stages,
  };
}

function resolveOperationsStage({
  missionType,
  vehicle,
  feasibility = null,
  crewExperience = 0,
  rng,
} = {}) {
  const probability = operationsProbability({
    missionType,
    vehicle,
    feasibility,
    crewExperience,
  });
  const stage = {
    stage: 'ORBIT_OPERATIONS',
    probability,
    success: true,
    roll: null,
    crewDeaths: 0,
  };

  if (probability < 1) {
    const roll = rng();
    stage.success = roll < probability;
    stage.roll = round(roll);
  }

  if (!stage.success && missionType === 'manned') {
    stage.crewDeaths = rng() < 0.5 ? 1 : 0;
  }

  return stage;
}

module.exports = {
  INSERTION_BASE_PROBABILITY,
  OPERATIONS_BASE_PROBABILITY,
  MIN_PROBABILITY,
  MAX_PROBABILITY,
  insertionProbability,
  operationsProbability,
  simulateStagedLaunch,
  resolveOperationsStage,
};
