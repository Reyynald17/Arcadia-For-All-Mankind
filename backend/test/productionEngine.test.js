const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase } = require('../test-support/fakeSupabase');
const { handleProductionComplete, productionGameDaysForType } = require('../src/services/productionEngine');

const event = {
  id: 'event-production-1',
  agency_id: 'agency-1',
  reference_id: 'vehicle-1',
  execute_at: '2026-11-18T00:00:00.000Z',
  payload: {},
};

function createDatabase() {
  return {
    vehicles: [{
      id: 'vehicle-1',
      agency_id: 'agency-1',
      name: 'Ariane Test',
      type: 'orbital-rocket',
      status: 'manufacturing',
      reliability: 70,
    }],
    logs: [],
  };
}

test('PRODUCTION_COMPLETE releases the vehicle and writes one legacy log', async () => {
  const { database, client } = createFakeSupabase(createDatabase());

  const result = await handleProductionComplete(client, event);

  assert.deepEqual(result, {
    vehicle_id: 'vehicle-1',
    status: 'testing',
    completed_at: '2026-11-18T00:00:00.000Z',
    already_completed: false,
  });
  assert.equal(database.vehicles[0].status, 'testing');
  assert.equal(database.logs.length, 1);
  assert.equal(database.logs[0].event_type, 'PRODUCTION_COMPLETED');
  assert.equal(database.logs[0].data.event_id, event.id);
});

test('PRODUCTION_COMPLETE is idempotent when retried', async () => {
  const { database, client } = createFakeSupabase(createDatabase());

  await handleProductionComplete(client, event);
  const second = await handleProductionComplete(client, event);

  assert.equal(second.already_completed, true);
  assert.equal(database.logs.length, 1);
});

test('production durations are known for every UI vehicle type', () => {
  for (const type of ['sounding-rocket', 'orbital-rocket', 'satellite', 'capsule', 'probe', 'lander']) {
    assert.ok(productionGameDaysForType(type) > 0);
  }
});
