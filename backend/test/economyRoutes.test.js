const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createFakeSupabase } = require('../test-support/fakeSupabase');
const { economyRpc } = require('../test-support/economyRpc');
const economyRoutes = require('../src/routes/economy');
const launchRoutes = require('../src/routes/launch');
const {
  handleRolloutComplete,
  handleLaunchIgnition,
  handleOrbitOperationsComplete,
} = require('../src/services/launchEngine');

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
      name: 'Test Agency',
      alignment: 'INDEPENDENT',
      science_points: 50,
      funding_usd: 15000000,
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
    vehicles: [
      {
        id: 'vehicle-1',
        agency_id: 'agency-1',
        name: 'Orbiter One',
        type: 'orbital-rocket',
        status: 'testing',
        reliability: 90,
        total_launches: 0,
        successful_launches: 0,
      },
      {
        id: 'vehicle-2',
        agency_id: 'agency-1',
        name: 'Orbiter Two',
        type: 'orbital-rocket',
        status: 'testing',
        reliability: 90,
        total_launches: 0,
        successful_launches: 0,
      },
    ],
    missions: [],
    mission_queue: [],
    agency_contracts: [],
    agency_grants: [],
    mission_rewards: [],
    scheduled_events: [],
    logs: [],
  };
}

async function startServer(client) {
  const app = express();
  app.use(express.json());
  app.use('/api/economy', economyRoutes(client));
  app.use('/api/launch', launchRoutes(client));

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

async function completeMission(client, database) {
  const rollout = database.scheduled_events.find((event) => event.event_type === 'ROLLOUT_COMPLETE');
  const ignition = database.scheduled_events.find((event) => event.event_type === 'LAUNCH_IGNITION');
  await handleRolloutComplete(client, rollout);
  const launched = await handleLaunchIgnition(client, ignition);
  assert.equal(launched.success, true);
  const orbitEvent = database.scheduled_events.find(
    (event) => event.event_type === 'ORBIT_OPERATIONS_COMPLETE',
  );
  assert.ok(orbitEvent);
  return handleOrbitOperationsComplete(client, orbitEvent);
}

function missingTableClient(base, tables) {
  const missingQuery = (table) => {
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      contains: () => query,
      order: () => query,
      limit: () => query,
      maybeSingle: () => query,
      then: (resolve) => resolve({
        data: null,
        error: {
          code: 'PGRST205',
          message: `Could not find the table 'public.${table}' in the schema cache`,
        },
      }),
    };
    return query;
  };
  return {
    from(table) {
      return tables.has(table) ? missingQuery(table) : base.from(table);
    },
    rpc: (...args) => base.rpc(...args),
  };
}

test('economy and queue endpoints report migration-required when tables are missing', async () => {
  const database = createDatabase();
  const { client: base } = createFakeSupabase(database, { rpc: economyRpc(database) });
  const client = missingTableClient(
    base,
    new Set(['agency_contracts', 'agency_grants', 'mission_rewards', 'mission_queue']),
  );
  const { server, baseUrl } = await startServer(client);

  try {
    const offers = await fetch(`${baseUrl}/api/economy/offers/agency-1`);
    const offersBody = await offers.json();
    assert.equal(offers.status, 503);
    assert.equal(offersBody.error, 'ECONOMY_MIGRATION_REQUIRED');

    const queue = await fetch(`${baseUrl}/api/launch/queue/agency-1`);
    assert.equal(queue.status, 503);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('grant claim is one-time and credits the agency through the RPC', async () => {
  const database = createDatabase();
  const { client } = createFakeSupabase(database, { rpc: economyRpc(database) });
  const { server, baseUrl } = await startServer(client);

  try {
    const first = await postJson(baseUrl, '/api/economy/grants/STARTUP_CAPITAL/claim', {
      agencyId: 'agency-1',
    });
    assert.equal(first.response.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.new_stats.funding_usd, 17000000);
    assert.equal(database.agency_grants.length, 1);

    const second = await postJson(baseUrl, '/api/economy/grants/STARTUP_CAPITAL/claim', {
      agencyId: 'agency-1',
    });
    assert.equal(second.response.status, 409, JSON.stringify(second.body));
    assert.equal(database.agencies[0].funding_usd, 17000000);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('contract mission pays base reward plus contract reward once', async () => {
  const database = createDatabase();
  const { client } = createFakeSupabase(database, { rpc: economyRpc(database) });
  const { server, baseUrl } = await startServer(client);

  try {
    const accepted = await postJson(
      baseUrl,
      '/api/economy/contracts/ATMOSPHERIC_SOUNDING/accept',
      { agencyId: 'agency-1' },
    );
    assert.equal(accepted.response.status, 201, JSON.stringify(accepted.body));

    const queued = await postJson(baseUrl, '/api/launch/queue', {
      agencyId: 'agency-1',
      missionName: 'Contract Mission',
      vehicleId: 'vehicle-1',
      missionType: 'test',
      contractKey: 'ATMOSPHERIC_SOUNDING',
    });
    assert.equal(queued.response.status, 202, JSON.stringify(queued.body));
    assert.equal(queued.body.promotion.promoted, true, JSON.stringify(queued.body.promotion));
    assert.equal(database.mission_queue[0].status, 'ACTIVE');
    assert.equal(database.missions[0].contract_id, database.agency_contracts[0].id);

    const completion = await completeMission(client, database);
    assert.equal(completion.rewards.funding_usd, 1100000);
    assert.equal(completion.rewards.rp, 4);
    assert.equal(completion.rewards.science_points, 10);
    assert.equal(database.agencies[0].funding_usd, 15850000);
    assert.equal(database.agencies[0].rp, 14);
    assert.equal(database.agencies[0].science_points, 80);
    assert.equal(database.agency_contracts[0].status, 'COMPLETED');
    assert.equal(database.mission_queue[0].status, 'COMPLETED');
    assert.equal(database.mission_rewards.length, 1);

    const replay = await completeMissionWithExistingEvent(client, database);
    assert.equal(replay.rewards.already_applied, true);
    assert.equal(database.mission_rewards.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function completeMissionWithExistingEvent(client, database) {
  const orbitEvent = database.scheduled_events.find(
    (event) => event.event_type === 'ORBIT_OPERATIONS_COMPLETE',
  );
  return handleOrbitOperationsComplete(client, orbitEvent);
}

test('mission queue serializes missions and starts the next after completion', async () => {
  const database = createDatabase();
  const { client } = createFakeSupabase(database, { rpc: economyRpc(database) });
  const { server, baseUrl } = await startServer(client);

  try {
    const first = await postJson(baseUrl, '/api/launch/queue', {
      agencyId: 'agency-1',
      missionName: 'First Mission',
      vehicleId: 'vehicle-1',
      missionType: 'test',
    });
    const second = await postJson(baseUrl, '/api/launch/queue', {
      agencyId: 'agency-1',
      missionName: 'Second Mission',
      vehicleId: 'vehicle-2',
      missionType: 'test',
    });

    assert.equal(first.response.status, 202, JSON.stringify(first.body));
    assert.equal(second.response.status, 202, JSON.stringify(second.body));
    assert.equal(first.body.promotion.promoted, true, JSON.stringify(first.body.promotion));
    assert.equal(second.body.promotion.promoted, false, JSON.stringify(second.body.promotion));
    assert.equal(second.body.promotion.reason, 'QUEUE_ACTIVE');
    assert.equal(database.missions.length, 1);
    assert.equal(database.mission_queue[0].status, 'ACTIVE');
    assert.equal(database.mission_queue[1].status, 'QUEUED');

    const completion = await completeMission(client, database);
    assert.equal(completion.status, 'COMPLETED');
    assert.equal(database.mission_queue[0].status, 'COMPLETED');

    const secondActive = database.mission_queue[1];
    assert.equal(secondActive.status, 'ACTIVE');
    assert.ok(secondActive.mission_id);
    assert.equal(database.missions.length, 2);
    assert.equal(database.vehicles[1].status, 'assigned');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('contract rejects a mission type that does not match the contract', async () => {
  const database = createDatabase();
  const { client } = createFakeSupabase(database, { rpc: economyRpc(database) });
  const { server, baseUrl } = await startServer(client);

  try {
    await postJson(baseUrl, '/api/economy/contracts/ATMOSPHERIC_SOUNDING/accept', {
      agencyId: 'agency-1',
    });

    const queued = await postJson(baseUrl, '/api/launch/queue', {
      agencyId: 'agency-1',
      missionName: 'Wrong Type',
      vehicleId: 'vehicle-1',
      missionType: 'scientific',
      contractKey: 'ATMOSPHERIC_SOUNDING',
    });

    assert.equal(queued.response.status, 400, JSON.stringify(queued.body));
    assert.match(queued.body.error, /requires a test mission/i);
    assert.equal(database.mission_queue.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
