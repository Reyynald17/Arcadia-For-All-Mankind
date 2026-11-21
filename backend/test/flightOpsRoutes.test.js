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
      user_id: 'user-1',
      controller_type: 'player',
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

function authenticate(req, _res, next) {
  req.authUser = { id: 'user-1' };
  next();
}

async function startServer(client) {
  const app = express();
  app.use(express.json());
  app.use('/api/production', productionRoutes(client, { authenticate }));
  app.use('/api/launch', launchRoutes(client, { authenticate }));

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

    const audit = database.audit_events.find((event) => event.action === 'PRODUCTION_STARTED');
    assert.ok(audit, 'production start should be audited');
    assert.equal(audit.actor_type, 'player');
    assert.equal(audit.delta_data.funding_usd, -2500000);

    const completion = await handleProductionComplete(client, database.scheduled_events[0]);
    assert.equal(completion.already_completed, false);
    assert.equal(database.vehicles[0].status, 'testing');
    assert.equal(database.logs[1].event_type, 'PRODUCTION_COMPLETED');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('vehicle performance overrides are owned, audited, and drive feasibility', async () => {
  const database = createDatabase();
  database.vehicles.push({
    id: 'vehicle-1',
    agency_id: 'agency-1',
    name: 'Orbiter One',
    type: 'orbital-rocket',
    status: 'testing',
    reliability: 90,
    vehicle_class: 'orbital',
    dry_mass_kg: 12000,
    propellant_mass_kg: 130000,
    payload_capacity_kg: 4500,
    delta_v_budget_m_s: 9450,
    crew_capacity: 0,
  });
  const { client } = createFakeSupabase(database);
  const { server, baseUrl } = await startServer(client);

  try {
    const response = await fetch(`${baseUrl}/api/production/vehicle/vehicle-1/performance`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agencyId: 'agency-1',
        vehicle_class: 'orbital',
        dry_mass_kg: 12000,
        propellant_mass_kg: 130000,
        payload_capacity_kg: 500,
        delta_v_budget_m_s: 2500,
        crew_capacity: 0,
        performance_note: 'Test envelope',
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(database.vehicles[0].delta_v_budget_m_s, 2500);
    assert.equal(database.vehicles[0].payload_capacity_kg, 500);
    assert.equal(database.vehicles[0].performance_note, 'Test envelope');
    assert.ok(body.changed_fields.includes('delta_v_budget_m_s'));
    assert.equal(body.defaults.delta_v_budget_m_s, 9450);

    const audit = database.audit_events.find(
      (event) => event.action === 'VEHICLE_PERFORMANCE_UPDATED',
    );
    assert.ok(audit, 'performance edit should be audited');
    assert.equal(audit.actor_type, 'player');
    assert.equal(audit.before_data.delta_v_budget_m_s, 9450);
    assert.equal(audit.after_data.delta_v_budget_m_s, 2500);
    assert.equal(audit.delta_data.delta_v_budget_m_s, -6950);

    const preview = await fetch(
      `${baseUrl}/api/launch/feasibility/agency-1?vehicleId=vehicle-1&missionType=test`,
    );
    const previewBody = await preview.json();
    assert.equal(preview.status, 200, JSON.stringify(previewBody));
    assert.equal(previewBody.feasibility.delta_v_available_m_s, 2500);
    assert.equal(previewBody.feasibility.delta_v_margin_m_s, 600);
    assert.equal(previewBody.feasibility.payload_margin_kg, 400);

    const reset = await fetch(`${baseUrl}/api/production/vehicle/vehicle-1/performance`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agencyId: 'agency-1', resetToDefaults: true }),
    });
    const resetBody = await reset.json();

    assert.equal(reset.status, 200, JSON.stringify(resetBody));
    assert.equal(database.vehicles[0].delta_v_budget_m_s, 9450);
    assert.equal(database.vehicles[0].payload_capacity_kg, 4500);
    assert.equal(database.vehicles[0].performance_note, null);
    assert.equal(resetBody.reset_to_defaults, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('vehicle performance overrides reject invalid values without writing', async () => {
  const database = createDatabase();
  database.vehicles.push({
    id: 'vehicle-1',
    agency_id: 'agency-1',
    name: 'Orbiter One',
    type: 'orbital-rocket',
    status: 'testing',
    delta_v_budget_m_s: 9450,
  });
  const { client } = createFakeSupabase(database);
  const { server, baseUrl } = await startServer(client);

  try {
    const response = await fetch(`${baseUrl}/api/production/vehicle/vehicle-1/performance`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agencyId: 'agency-1', delta_v_budget_m_s: -50 }),
    });
    const body = await response.json();

    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match(body.message, /Delta-v budget/);
    assert.equal(database.vehicles[0].delta_v_budget_m_s, 9450);
    assert.ok(!(database.audit_events || []).some(
      (event) => event.action === 'VEHICLE_PERFORMANCE_UPDATED',
    ));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('feasibility preview returns the vehicle envelope before scheduling', async () => {
  const database = createDatabase();
  database.vehicles.push({
    id: 'vehicle-1',
    agency_id: 'agency-1',
    name: 'Orbiter One',
    type: 'orbital-rocket',
    status: 'testing',
    reliability: 90,
  });
  const { client } = createFakeSupabase(database);
  const { server, baseUrl } = await startServer(client);

  try {
    const response = await fetch(
      `${baseUrl}/api/launch/feasibility/agency-1?vehicleId=vehicle-1&missionType=test`,
    );
    const body = await response.json();

    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.feasibility.feasible, true);
    assert.equal(body.feasibility.delta_v_available_m_s, 9450);
    assert.equal(body.feasibility.delta_v_required_m_s, 1900);
    assert.equal(body.feasibility.payload_margin_kg, 4400);
    assert.equal(body.feasibility.estimated_cost.funding_usd, 321000);
    assert.equal(body.feasibility.estimated_duration.estimated_total_game_days_min, 84);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('queue rejects a vehicle that is not cleared for the mission type', async () => {
  const database = createDatabase();
  database.vehicles.push({
    id: 'capsule-1',
    agency_id: 'agency-1',
    name: 'Valor Capsule',
    type: 'capsule',
    status: 'testing',
    reliability: 90,
  });
  const { client } = createFakeSupabase(database);
  const { server, baseUrl } = await startServer(client);

  try {
    const response = await fetch(`${baseUrl}/api/launch/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agencyId: 'agency-1',
        missionName: 'Wrong Vehicle',
        vehicleId: 'capsule-1',
        missionType: 'test',
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match(body.error, /not cleared for test missions/i);
    assert.equal(body.details.feasibility.feasible, false);
    assert.ok(
      body.details.feasibility.blockers.some(
        (blocker) => blocker.code === 'VEHICLE_CLASS_MISMATCH',
      ),
    );
    assert.equal((database.mission_queue || []).length, 0);
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
    assert.equal(database.agencies[0].funding_usd, 49679000);
    assert.equal(body.missionCost.funding_usd, 321000);
    assert.ok(body.duration.total_game_days >= body.duration.estimated_total_game_days_min);
    assert.equal(database.scheduled_events.length, 2);

    const audit = database.audit_events.find((event) => event.action === 'MISSION_SCHEDULED');
    assert.ok(audit, 'mission scheduling should be audited');
    assert.equal(audit.actor_type, 'agency');
    assert.equal(audit.entity_id, database.missions[0].id);
    assert.equal(audit.delta_data.funding_usd, -321000);

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
      const orbitEvent = database.scheduled_events.find(
        (event) => event.event_type === 'ORBIT_OPERATIONS_COMPLETE',
      );
      assert.ok(orbitEvent);
      assert.equal(orbitEvent.payload.orbit_game_days, body.duration.orbit_operations_game_days);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
