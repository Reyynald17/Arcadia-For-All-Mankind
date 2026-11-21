const { ORBIT_OPERATIONS_GAME_DAYS } = require('./orbitalEngine');
const {
  ROLLOUT_MIN_GAME_DAYS,
  ROLLOUT_MAX_GAME_DAYS,
  COUNTDOWN_GAME_DAYS,
} = require('./missionPlan');

const MISSION_COST_BASE_USD = Object.freeze({
  test: 250000,
  scientific: 900000,
  manned: 2200000,
  colonial: 5000000,
});

const DELTA_V_COST_USD_PER_MPS = 35;
const PAYLOAD_COST_USD_PER_KG = 40;
const PREPARATION_DAYS_PER_DELTA_V = 400;
const PREPARATION_DAYS_PER_PAYLOAD_KG = 1000;
const ORBIT_OPS_DAYS_PER_DELTA_V = 2500;
const ORBIT_OPS_DAYS_PER_PAYLOAD_KG = 500;

function nonNegative(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function roundUsd(value) {
  return Math.round(value / 1000) * 1000;
}

function calculateMissionCost({ missionType, deltaVRequiredMps, payloadRequiredKg } = {}) {
  const baseFunding = MISSION_COST_BASE_USD[missionType] || 0;
  const deltaV = nonNegative(deltaVRequiredMps);
  const payload = nonNegative(payloadRequiredKg);
  const deltaVFunding = roundUsd(deltaV * DELTA_V_COST_USD_PER_MPS);
  const payloadFunding = roundUsd(payload * PAYLOAD_COST_USD_PER_KG);

  return {
    funding_usd: baseFunding + deltaVFunding + payloadFunding,
    base_funding_usd: baseFunding,
    delta_v_funding_usd: deltaVFunding,
    payload_funding_usd: payloadFunding,
    delta_v_required_m_s: deltaV,
    payload_required_kg: payload,
  };
}

function calculateMissionDuration({ missionType, deltaVRequiredMps, payloadRequiredKg } = {}) {
  const deltaV = nonNegative(deltaVRequiredMps);
  const payload = nonNegative(payloadRequiredKg);
  const baseOrbitGameDays = ORBIT_OPERATIONS_GAME_DAYS[missionType]
    || ORBIT_OPERATIONS_GAME_DAYS.test;

  const preparationDeltaVGameDays = Math.ceil(deltaV / PREPARATION_DAYS_PER_DELTA_V);
  const preparationPayloadGameDays = Math.ceil(payload / PREPARATION_DAYS_PER_PAYLOAD_KG);
  const preparationComplexityGameDays =
    preparationDeltaVGameDays + preparationPayloadGameDays;

  const orbitDeltaVGameDays = Math.ceil(deltaV / ORBIT_OPS_DAYS_PER_DELTA_V);
  const orbitPayloadGameDays = Math.ceil(payload / ORBIT_OPS_DAYS_PER_PAYLOAD_KG);
  const orbitOperationsGameDays =
    baseOrbitGameDays + orbitDeltaVGameDays + orbitPayloadGameDays;

  return {
    preparation_complexity_game_days: preparationComplexityGameDays,
    preparation_delta_v_game_days: preparationDeltaVGameDays,
    preparation_payload_game_days: preparationPayloadGameDays,
    orbit_operations_game_days: orbitOperationsGameDays,
    orbit_base_game_days: baseOrbitGameDays,
    orbit_delta_v_game_days: orbitDeltaVGameDays,
    orbit_payload_game_days: orbitPayloadGameDays,
    rollout_base_min_game_days: ROLLOUT_MIN_GAME_DAYS,
    rollout_base_max_game_days: ROLLOUT_MAX_GAME_DAYS,
    countdown_game_days: COUNTDOWN_GAME_DAYS,
    estimated_total_game_days_min:
      ROLLOUT_MIN_GAME_DAYS
      + preparationComplexityGameDays
      + COUNTDOWN_GAME_DAYS
      + orbitOperationsGameDays,
    estimated_total_game_days_max:
      ROLLOUT_MAX_GAME_DAYS
      + preparationComplexityGameDays
      + COUNTDOWN_GAME_DAYS
      + orbitOperationsGameDays,
  };
}

module.exports = {
  MISSION_COST_BASE_USD,
  DELTA_V_COST_USD_PER_MPS,
  PAYLOAD_COST_USD_PER_KG,
  PREPARATION_DAYS_PER_DELTA_V,
  PREPARATION_DAYS_PER_PAYLOAD_KG,
  ORBIT_OPS_DAYS_PER_DELTA_V,
  ORBIT_OPS_DAYS_PER_PAYLOAD_KG,
  calculateMissionCost,
  calculateMissionDuration,
};
