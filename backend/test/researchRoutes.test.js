const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createFakeSupabase } = require('../test-support/fakeSupabase');
const researchRoutes = require('../src/routes/research');

function createDatabase(overrides = {}) {
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
      total_engineers: 20,
      rp: 0,
      western_standing: 50,
      eastern_standing: 50,
    }],
    technologies: [{
      node_id: 'rocketry-1',
      name: 'Basic Rocketry',
      era: 'ERA_1',
      era_number: 1,
      research_cost_science: 100,
      research_cost_funding: 2000000,
      base_days: 100,
      prereq_trl_count: 0,
      prerequisite_node_ids: [],
      prerequisite: [],
      alignment_affinity: 'ANY',
      is_export_controlled: false,
      static_test_cost: 300000,
      max_trl: 9,
      spec: {
        cost_modifiers: {
          INDEPENDENT: { science_mult: 1.25, days_mult: 1.2 },
        },
      },
    }],
    agency_tech_nodes: [],
    scheduled_events: [],
    logs: [],
    ...overrides,
  };
}

async function startServer(client) {
  const app = express();
  app.use(express.json());
  app.use('/api/research', researchRoutes(client));

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

test('research start charges canonical costs and schedules TECH_COMPLETE', async () => {
  const { database, client } = createFakeSupabase(createDatabase());
  const { server, baseUrl } = await startServer(client);

  try {
    const response = await fetch(`${baseUrl}/api/research/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agencyId: 'agency-1', nodeId: 'rocketry-1' }),
    });
    const body = await response.json();

    assert.equal(response.status, 201, JSON.stringify(body));
    assert.deepEqual(body.cost, { science_points: 125, funding_usd: 2000000 });
    assert.equal(body.durationGameDays, 120);
    assert.equal(database.agencies[0].science_points, 375);
    assert.equal(database.agencies[0].funding_usd, 48000000);
    assert.equal(database.agency_tech_nodes[0].status, 'RESEARCHING');
    assert.equal(database.scheduled_events.length, 1);
    assert.equal(database.scheduled_events[0].event_type, 'TECH_COMPLETE');
    assert.equal(database.logs[0].event_type, 'RESEARCH_STARTED');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('research start rejects export-controlled nodes without bloc standing', async () => {
  const database = createDatabase();
  database.agencies[0].alignment = 'WESTERN';
  database.technologies[0].alignment_affinity = 'EASTERN';
  database.technologies[0].is_export_controlled = true;
  const { client } = createFakeSupabase(database);
  const { server, baseUrl } = await startServer(client);

  try {
    const response = await fetch(`${baseUrl}/api/research/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agencyId: 'agency-1', nodeId: 'rocketry-1' }),
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.match(body.error, /EMBARGOED/);
    assert.equal(database.agencies[0].science_points, 500);
    assert.equal(database.scheduled_events.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('static fire schedules a test, deducts funding, and blocks duplicates', async () => {
  const database = createDatabase();
  database.agency_tech_nodes.push({
    id: 'node-1',
    agency_id: 'agency-1',
    node_id: 'rocketry-1',
    status: 'UNLOCKED',
    current_trl: 4,
    trl_xp: 0,
  });
  const { client } = createFakeSupabase(database);
  const { server, baseUrl } = await startServer(client);

  try {
    const payload = { agencyId: 'agency-1', nodeId: 'rocketry-1' };
    const response = await fetch(`${baseUrl}/api/research/static-fire`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json();

    assert.equal(response.status, 202, JSON.stringify(body));
    assert.equal(body.testCostUsd, 300000);
    assert.ok(body.durationGameDays >= 15 && body.durationGameDays <= 30);
    assert.equal(database.agencies[0].funding_usd, 49700000);
    assert.equal(database.scheduled_events.length, 1);
    assert.equal(database.scheduled_events[0].event_type, 'STATIC_FIRE');
    assert.equal(database.scheduled_events[0].status, 'PENDING');
    assert.equal(database.logs[0].event_type, 'STATIC_FIRE_STARTED');

    const duplicate = await fetch(`${baseUrl}/api/research/static-fire`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const duplicateBody = await duplicate.json();

    assert.equal(duplicate.status, 400);
    assert.match(duplicateBody.error, /already scheduled/);
    assert.equal(database.agencies[0].funding_usd, 49700000);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
