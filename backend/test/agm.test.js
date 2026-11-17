const test = require('node:test');
const assert = require('node:assert/strict');
const AGMEngine = require('../src/services/agm');
const { createSeededRng } = require('../src/services/seededRng');

const agency = { rp: 0 };
const vehicle = { reliability: 70 };

test('mission simulation is deterministic for the same seed', () => {
  const first = AGMEngine.simulateMission(
    agency,
    vehicle,
    'test',
    createSeededRng('mission-seed:event-id'),
  );
  const second = AGMEngine.simulateMission(
    agency,
    vehicle,
    'test',
    createSeededRng('mission-seed:event-id'),
  );

  assert.deepEqual(first, second);
});

test('mission simulation accepts a controlled random source', () => {
  const low = AGMEngine.simulateMission(agency, vehicle, 'scientific', () => 0);
  const high = AGMEngine.simulateMission(agency, vehicle, 'scientific', () => 0.999999);

  assert.ok(high.finalScore > low.finalScore);
});
