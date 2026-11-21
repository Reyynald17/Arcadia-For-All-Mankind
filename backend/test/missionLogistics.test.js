const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateMissionCost,
  calculateMissionDuration,
} = require('../src/services/missionLogistics');
const { planLaunchSchedule } = require('../src/services/missionPlan');

test('mission cost scales from base, delta-v, and payload', () => {
  const cost = calculateMissionCost({
    missionType: 'test',
    deltaVRequiredMps: 1900,
    payloadRequiredKg: 100,
  });

  assert.equal(cost.base_funding_usd, 250000);
  assert.equal(cost.delta_v_funding_usd, 67000);
  assert.equal(cost.payload_funding_usd, 4000);
  assert.equal(cost.funding_usd, 321000);
});

test('higher delta-v and payload increase cost and operations duration', () => {
  const standard = calculateMissionCost({
    missionType: 'scientific',
    deltaVRequiredMps: 3300,
    payloadRequiredKg: 600,
  });
  const polar = calculateMissionCost({
    missionType: 'scientific',
    deltaVRequiredMps: 4530,
    payloadRequiredKg: 600,
  });

  assert.equal(standard.funding_usd, 1040000);
  assert.equal(polar.funding_usd, 1083000);
  assert.ok(polar.funding_usd > standard.funding_usd);

  const standardDuration = calculateMissionDuration({
    missionType: 'scientific',
    deltaVRequiredMps: 3300,
    payloadRequiredKg: 600,
  });
  const polarDuration = calculateMissionDuration({
    missionType: 'scientific',
    deltaVRequiredMps: 4530,
    payloadRequiredKg: 600,
  });

  assert.equal(standardDuration.preparation_complexity_game_days, 10);
  assert.equal(standardDuration.orbit_operations_game_days, 184);
  assert.equal(standardDuration.estimated_total_game_days_min, 240);
  assert.equal(polarDuration.preparation_complexity_game_days, 13);
  assert.ok(
    polarDuration.estimated_total_game_days_min
    > standardDuration.estimated_total_game_days_min,
  );
});

test('deep-space colonial missions carry the heaviest logistics envelope', () => {
  const cost = calculateMissionCost({
    missionType: 'colonial',
    deltaVRequiredMps: 5200,
    payloadRequiredKg: 2500,
  });
  const duration = calculateMissionDuration({
    missionType: 'colonial',
    deltaVRequiredMps: 5200,
    payloadRequiredKg: 2500,
  });

  assert.equal(cost.funding_usd, 5282000);
  assert.equal(duration.preparation_complexity_game_days, 16);
  assert.equal(duration.orbit_operations_game_days, 373);
  assert.equal(duration.estimated_total_game_days_min, 435);
  assert.equal(duration.estimated_total_game_days_max, 450);
});

test('preparation complexity extends the deterministic rollout window', () => {
  const now = new Date('2026-11-16T00:00:00.000Z');
  const multiplier = 52.142857;
  const base = planLaunchSchedule({ missionSeed: 42, multiplier, now });
  const loaded = planLaunchSchedule({
    missionSeed: 42,
    multiplier,
    now,
    preparationGameDays: 10,
  });

  assert.equal(loaded.rolloutGameDays, base.rolloutGameDays + 10);
  assert.equal(loaded.preparationGameDays, 10);
  assert.ok(loaded.scheduledLaunchAt > base.scheduledLaunchAt);
});
