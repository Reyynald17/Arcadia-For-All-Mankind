const test = require('node:test');
const assert = require('node:assert/strict');
const {
  insertionProbability,
  operationsProbability,
  simulateStagedLaunch,
  resolveOperationsStage,
} = require('../src/services/missionRisk');

function sequenceRng(values) {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}

test('insertion probability follows reliability, margins, and clamps', () => {
  assert.equal(
    insertionProbability({ missionType: 'scientific', vehicle: { reliability: 70 } }),
    0.94,
  );
  assert.equal(
    insertionProbability({
      missionType: 'scientific',
      vehicle: { reliability: 90 },
      feasibility: { delta_v_margin_pct: 30 },
    }),
    0.98,
  );
  assert.equal(
    insertionProbability({
      missionType: 'scientific',
      vehicle: { reliability: 70 },
      feasibility: { delta_v_margin_pct: 2 },
    }),
    0.9,
  );
  assert.equal(
    insertionProbability({
      missionType: 'scientific',
      vehicle: { reliability: 0 },
      feasibility: { delta_v_margin_pct: 2 },
    }),
    0.83,
  );
  assert.equal(
    insertionProbability({
      missionType: 'colonial',
      vehicle: { reliability: 100 },
      feasibility: { delta_v_margin_pct: 30 },
    }),
    0.95,
  );
  assert.equal(
    insertionProbability({ missionType: 'test', vehicle: { reliability: 10 } }),
    1,
  );
});

test('operations probability adds crew experience for manned flights', () => {
  assert.equal(
    operationsProbability({ missionType: 'scientific', vehicle: { reliability: 70 } }),
    0.95,
  );
  assert.equal(
    operationsProbability({
      missionType: 'manned',
      vehicle: { reliability: 90 },
      feasibility: { delta_v_margin_pct: 30 },
      crewExperience: 3,
    }),
    0.976,
  );
  assert.equal(
    operationsProbability({
      missionType: 'manned',
      vehicle: { reliability: 70 },
      crewExperience: 50,
    }),
    0.97,
  );
  assert.equal(
    operationsProbability({ missionType: 'test', vehicle: { reliability: 10 } }),
    1,
  );
});

test('test missions skip the insertion roll and stay deterministic', () => {
  const input = {
    agency: { rp: 100 },
    vehicle: { reliability: 90 },
    missionType: 'test',
    rng: sequenceRng([0.4]),
  };

  const first = simulateStagedLaunch(input);
  const second = simulateStagedLaunch(input);

  assert.deepEqual(first, second);
  assert.equal(first.failed_stage, null);
  assert.equal(first.stages.length, 2);
  assert.equal(first.stages[1].stage, 'ORBIT_INSERTION');
  assert.equal(first.stages[1].probability, 1);
  assert.equal(first.stages[1].roll, null);
});

test('an insertion failure converts the launch into a partial failure', () => {
  const scientific = simulateStagedLaunch({
    agency: { rp: 100 },
    vehicle: { reliability: 90 },
    missionType: 'scientific',
    rng: sequenceRng([0.9, 0.999]),
  });

  assert.equal(scientific.failed_stage, 'ORBIT_INSERTION');
  assert.equal(scientific.stages[0].success, true);
  assert.equal(scientific.stages[1].success, false);
  assert.equal(scientific.rpGain, 0);
  assert.equal(scientific.scienceGain, 5);
  assert.equal(scientific.ipiChange, -8);
  assert.equal(scientific.siChange, -4);
  assert.equal(scientific.crewDeaths, 0);

  const manned = simulateStagedLaunch({
    agency: { rp: 100 },
    vehicle: { reliability: 90 },
    missionType: 'manned',
    rng: sequenceRng([0.9, 0.999, 0.1]),
  });

  assert.equal(manned.failed_stage, 'ORBIT_INSERTION');
  assert.equal(manned.crewDeaths, 1);
});

test('a launch-stage failure short-circuits the insertion roll', () => {
  const result = simulateStagedLaunch({
    agency: { rp: 0 },
    vehicle: { reliability: 40 },
    missionType: 'scientific',
    rng: sequenceRng([0]),
  });

  assert.equal(result.success, false);
  assert.equal(result.failed_stage, 'LAUNCH');
  assert.equal(result.crewDeaths, 0);
  assert.equal(result.stages[0].roll, null);
  assert.equal(result.stages[1].success, true);
  assert.notEqual(result.stages[1].roll, null);
});

test('operations stage draws only when probability is below one', () => {
  const testMission = resolveOperationsStage({
    missionType: 'test',
    vehicle: { reliability: 70 },
    rng: sequenceRng([0.99]),
  });
  assert.equal(testMission.probability, 1);
  assert.equal(testMission.roll, null);
  assert.equal(testMission.success, true);

  const failedScientific = resolveOperationsStage({
    missionType: 'scientific',
    vehicle: { reliability: 70 },
    rng: sequenceRng([0.99]),
  });
  assert.equal(failedScientific.probability, 0.95);
  assert.equal(failedScientific.success, false);
  assert.equal(failedScientific.crewDeaths, 0);

  const failedManned = resolveOperationsStage({
    missionType: 'manned',
    vehicle: { reliability: 70 },
    rng: sequenceRng([0.95, 0.2]),
  });
  assert.equal(failedManned.success, false);
  assert.equal(failedManned.crewDeaths, 1);
});
