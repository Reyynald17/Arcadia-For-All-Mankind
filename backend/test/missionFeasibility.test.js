const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateMissionFeasibility,
  vehiclePerformance,
} = require('../src/services/missionFeasibility');

const agency = {
  funding_usd: 15000000,
  launch_site_lat: 28.5,
};

function makeVehicle(type, overrides = {}) {
  return {
    id: `vehicle-${type}`,
    type,
    ...overrides,
  };
}

function blockerCodes(feasibility) {
  return feasibility.blockers.map((blocker) => blocker.code);
}

test('orbital rocket is feasible for a standard test mission', () => {
  const feasibility = evaluateMissionFeasibility({
    agency,
    vehicle: makeVehicle('orbital-rocket'),
    missionType: 'test',
  });

  assert.equal(feasibility.feasible, true);
  assert.equal(feasibility.delta_v_available_m_s, 9450);
  assert.equal(feasibility.delta_v_required_m_s, 1900);
  assert.equal(feasibility.delta_v_margin_m_s, 7550);
  assert.equal(feasibility.payload_margin_kg, 4400);
  assert.equal(feasibility.crew_margin, 0);
  assert.equal(feasibility.inclination_penalty_m_s, 0);
  assert.equal(feasibility.estimated_cost.funding_usd, 321000);
  assert.equal(feasibility.estimated_cost.base_funding_usd, 250000);
  assert.equal(feasibility.estimated_cost.delta_v_funding_usd, 67000);
  assert.equal(feasibility.estimated_cost.payload_funding_usd, 4000);
  assert.equal(feasibility.estimated_duration.preparation_complexity_game_days, 6);
  assert.equal(feasibility.estimated_duration.orbit_operations_game_days, 32);
  assert.equal(feasibility.estimated_duration.estimated_total_game_days_min, 84);
  assert.equal(feasibility.estimated_duration.estimated_total_game_days_max, 99);
});

test('capsule is rejected for a test mission but cleared for crewed flight', () => {
  const testMission = evaluateMissionFeasibility({
    agency,
    vehicle: makeVehicle('capsule'),
    missionType: 'test',
  });
  const crewedMission = evaluateMissionFeasibility({
    agency,
    vehicle: makeVehicle('capsule'),
    missionType: 'manned',
    targetInclinationDeg: 51.6,
  });

  assert.equal(testMission.feasible, false);
  assert.ok(blockerCodes(testMission).includes('VEHICLE_CLASS_MISMATCH'));
  assert.equal(crewedMission.feasible, true);
  assert.equal(crewedMission.delta_v_required_m_s, 3862);
  assert.equal(crewedMission.delta_v_margin_m_s, 338);
  assert.equal(crewedMission.crew_margin, 1);
});

test('orbital rocket cannot carry crew and says why', () => {
  const feasibility = evaluateMissionFeasibility({
    agency,
    vehicle: makeVehicle('orbital-rocket'),
    missionType: 'manned',
  });

  assert.equal(feasibility.feasible, false);
  assert.ok(blockerCodes(feasibility).includes('VEHICLE_CLASS_MISMATCH'));
  assert.ok(blockerCodes(feasibility).includes('CREW_SHORTFALL'));
});

test('lander is the only vehicle cleared for colonial missions', () => {
  const lander = evaluateMissionFeasibility({
    agency,
    vehicle: makeVehicle('lander'),
    missionType: 'colonial',
  });
  const probe = evaluateMissionFeasibility({
    agency,
    vehicle: makeVehicle('probe'),
    missionType: 'colonial',
  });

  assert.equal(lander.feasible, true);
  assert.equal(lander.delta_v_margin_m_s, 600);
  assert.equal(probe.feasible, false);
  assert.ok(blockerCodes(probe).includes('VEHICLE_CLASS_MISMATCH'));
  assert.ok(blockerCodes(probe).includes('DELTA_V_DEFICIT'));
});

test('a polar target adds a plane-change penalty and can make a mission infeasible', () => {
  const feasibility = evaluateMissionFeasibility({
    agency,
    vehicle: makeVehicle('satellite'),
    missionType: 'scientific',
    targetInclinationDeg: 90,
  });

  assert.equal(feasibility.inclination_penalty_m_s, 1230);
  assert.equal(feasibility.delta_v_required_m_s, 4530);
  assert.equal(feasibility.feasible, false);
  assert.ok(blockerCodes(feasibility).includes('DELTA_V_DEFICIT'));
});

test('target inclination below the launch site is rejected', () => {
  const feasibility = evaluateMissionFeasibility({
    agency,
    vehicle: makeVehicle('orbital-rocket'),
    missionType: 'test',
    targetInclinationDeg: 10,
  });

  assert.equal(feasibility.feasible, false);
  assert.ok(blockerCodes(feasibility).includes('TARGET_BELOW_SITE_LATITUDE'));
});

test('vehicle database overrides take precedence over the built-in profile', () => {
  const performance = vehiclePerformance(makeVehicle('orbital-rocket', {
    delta_v_budget_m_s: 1800,
    payload_capacity_kg: 50,
    crew_capacity: 0,
    vehicle_class: 'orbital',
  }));
  const feasibility = evaluateMissionFeasibility({
    agency,
    vehicle: makeVehicle('orbital-rocket', {
      delta_v_budget_m_s: 1800,
      payload_capacity_kg: 50,
    }),
    missionType: 'test',
  });

  assert.equal(performance.delta_v_budget_m_s, 1800);
  assert.equal(performance.payload_capacity_kg, 50);
  assert.equal(feasibility.feasible, false);
  assert.ok(blockerCodes(feasibility).includes('DELTA_V_DEFICIT'));
  assert.ok(blockerCodes(feasibility).includes('PAYLOAD_OVERLOAD'));
});

test('a low but positive delta-v margin produces a warning, not a blocker', () => {
  const feasibility = evaluateMissionFeasibility({
    agency,
    vehicle: makeVehicle('orbital-rocket', { delta_v_budget_m_s: 1900 }),
    missionType: 'test',
  });

  assert.equal(feasibility.feasible, true);
  assert.equal(feasibility.delta_v_margin_m_s, 0);
  assert.ok(feasibility.warnings.some((warning) => warning.code === 'LOW_DELTA_V_MARGIN'));
});

test('insufficient funding blocks scheduling and reports the shortfall', () => {
  const feasibility = evaluateMissionFeasibility({
    agency: { ...agency, funding_usd: 100000 },
    vehicle: makeVehicle('orbital-rocket'),
    missionType: 'test',
  });

  assert.equal(feasibility.feasible, false);
  assert.ok(blockerCodes(feasibility).includes('INSUFFICIENT_FUNDING'));
  assert.equal(feasibility.funding_required_usd, 321000);
  assert.equal(feasibility.funding_margin_usd, -221000);
});

test('unknown mission and vehicle types fail closed', () => {
  const unknownMission = evaluateMissionFeasibility({
    agency,
    vehicle: makeVehicle('orbital-rocket'),
    missionType: 'unknown',
  });
  const unknownVehicle = evaluateMissionFeasibility({
    agency,
    vehicle: makeVehicle('unknown'),
    missionType: 'test',
  });

  assert.equal(unknownMission.feasible, false);
  assert.ok(blockerCodes(unknownMission).includes('UNKNOWN_MISSION_TYPE'));
  assert.equal(unknownVehicle.feasible, false);
  assert.ok(blockerCodes(unknownVehicle).includes('MISSING_PERFORMANCE_PROFILE'));
});
