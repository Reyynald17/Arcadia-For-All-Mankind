const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createFakeSupabase } = require('../test-support/fakeSupabase');
const productionRoutes = require('../src/routes/production');
const launchRoutes = require('../src/routes/launch');
const { handleProductionComplete } = require('../src/services/productionEngine');
const { handleRolloutComplete, handleLaunchIgnition } = require('../src/services/launchEngine');

function createDatabase() {
  return {
    seasons: [{
      id: 'season-1',
      name: 'Season 1 - 1969',
      start_real_time: '2026-11-16T00:00:00.000Z',
      epoch_game_date: '1969-07-20',
      time_scale_multiplier: 52.142857,
      status: 'ACTIVE',
    }],
    agencies: [{
      id: 'agency-1',
      season_id: 'season-1',
      alignment: 'INDEPENDENT',
      science_points: 500,
      funding_usd: 50000000,
      ap: 50,
      budget: 50,
      rp: 0,
      ipi: 60,
      si: 70,
      slr: 0,
      total_launches: 0,
      successful_launches: 0,
      western_standing: 50,
      eastern_standing: 50,
      launch_site_lat: 28.5,
      launch_site_lon: -80.6,
    }],
    vehicles: [],
    missions: [],
    scheduled_events: [],
    logs: [],
  };
}

async function startServer(client) {
  const app = express();
  app.use(express.json());
  app.use('/api/production', productionRoutes(client));
  app.use('/api/launch', launchRoutes(client));

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

test('production route schedules assembly and the worker releases the vehicle', async () => {
  const { database, client } = createFakeSupabase(createDatabase());
  const { server, baseUrl } = await startServer(client);

  try {
    const response = await fetch(`${baseUrl}/api/production/vehicle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agencyId: 'agency-1',
        vehicleName: 'Orbiter One',
        vehicleType: 'orbital-rocket',
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 202);
    assert.equal(body.vehicle.status, 'manufacturing');
    assert.equal(body.productionGameDays, 90);
    assert.equal(database.vehicles[0].status, 'manufacturing');
    assert.equal(database.scheduled_events.length, 1);
    assert.equal(database.scheduled_events[0].event_type, 'PRODUCTION_COMPLETE');
    assert.equal(database.agencies[0].funding_usd, 47500000);
    assert.equal(database.logs[0].event_type, 'PRODUCTION_STARTED');

    const completion = await handleProductionComplete(client, database.scheduled_events[0]);
    assert.equal(completion.already_completed, false);
    assert.equal(database.vehicles[0].status, 'testing');
    assert.equal(database.logs[1].event_type, 'PRODUCTION_COMPLETED');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('launch route schedules rollout plus ignition and the worker completes the mission', async () => {
  const database = createDatabase();
  database.vehicles.push({
    id: 'vehicle-1',
    agency_id: 'agency-1',
    name: 'Orbiter One',
    type: 'orbital-rocket',
    status: 'testing',
    reliability: 90,
    total_launches: 0,
    successful_launches: 0,
  });
  const { client } = createFakeSupabase(database);
  const { server, baseUrl } = await startServer(client);

  try {
    const response = await fetch(`${baseUrl}/api/launch/mission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agencyId: 'agency-1',
        missionName: 'Mission One',
        vehicleId: 'vehicle-1',
        missionType: 'test',
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 202, JSON.stringify(body));
    assert.equal(body.mission.status, 'ROLLOUT');
    assert.ok(body.rolloutCompletesAt);
    assert.ok(body.scheduledLaunchAt);
    assert.equal(database.vehicles[0].status, 'assigned');
    assert.equal(database.agencies[0].funding_usd, 49750000);
    assert.equal(database.scheduled_events.length, 2);
    assert.deepEqual(
      database.scheduled_events.map((event) => event.event_type).sort(),
      ['LAUNCH_IGNITION', 'ROLLOUT_COMPLETE'],
    );

    const rolloutEvent = database.scheduled_events.find((event) => event.event_type === 'ROLLOUT_COMPLETE');
    const ignitionEvent = database.scheduled_events.find((event) => event.event_type === 'LAUNCH_IGNITION');

    await handleRolloutComplete(client, rolloutEvent);
    assert.equal(database.missions[0].status, 'COUNTDOWN');

    const ignition = await handleLaunchIgnition(client, ignitionEvent);
    assert.equal(ignition.already_completed, false);
    assert.ok(['ORBIT', 'FAILED'].includes(database.missions[0].status));
    assert.equal(database.agencies[0].total_launches, 1);
    assert.equal(database.vehicles[0].status, 'testing');
    assert.ok(['ORBIT_INSERTION', 'MISSION_COMPLETED'].includes(database.logs.at(-1).event_type));
    if (database.missions[0].status === 'ORBIT') {
      assert.equal(database.scheduled_events.length, 3);
      assert.equal(
        database.scheduled_events.filter((event) => event.event_type === 'ORBIT_OPERATIONS_COMPLETE').length,
        1,
      );
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
