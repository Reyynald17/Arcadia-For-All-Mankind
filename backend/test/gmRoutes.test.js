const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createFakeSupabase } = require('../test-support/fakeSupabase');
const gmRoutes = require('../src/routes/gm');

const GM_KEY = 'test-gm-key';
const FIXED_NOW = new Date('2026-11-16T00:00:00.000Z');

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
      name: 'Qoder Test Agency',
      country: 'Indonesia',
      alignment: 'INDEPENDENT',
      science_points: 50,
      funding_usd: 15000000,
      rp: 0,
      total_launches: 0,
      successful_launches: 0,
    }, {
      id: 'agency-2',
      name: 'Other Agency',
    }],
    vehicles: [{
      id: 'vehicle-1',
      agency_id: 'agency-1',
      name: 'Sonda Qoder I',
      status: 'manufacturing',
    }],
    missions: [],
    scheduled_events: [{
      id: 'ev-op-2',
      agency_id: 'agency-1',
      event_type: 'PRODUCTION_COMPLETE',
      reference_id: 'vehicle-1',
      execute_at: '2026-11-16T04:00:00.000Z',
      status: 'PENDING',
    }, {
      id: 'ev-op-1',
      agency_id: 'agency-1',
      event_type: 'ROLLOUT_COMPLETE',
      reference_id: 'mission-1',
      execute_at: '2026-11-16T02:00:00.000Z',
      status: 'PENDING',
    }, {
      id: 'ev-dip',
      agency_id: 'agency-1',
      event_type: 'DIPLOMACY_NPC_TICK',
      reference_id: null,
      execute_at: '2026-11-16T01:00:00.000Z',
      status: 'PENDING',
    }, {
      id: 'ev-done',
      agency_id: 'agency-1',
      event_type: 'TECH_COMPLETE',
      reference_id: 'tech-1',
      execute_at: '2026-11-15T00:00:00.000Z',
      status: 'PROCESSED',
    }],
  };
}

async function startServer(client, options = { accessKey: GM_KEY }) {
  const app = express();
  app.use(express.json());
  app.use('/api/gm', gmRoutes(client, { ...options, now: () => FIXED_NOW }));

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

function gmHeaders(key = GM_KEY) {
  return {
    'Content-Type': 'application/json',
    'x-gm-key': key,
  };
}

test('GM API rejects requests when no key is configured or the key is wrong', async () => {
  const { database, client } = createFakeSupabase(createDatabase());
  const disabled = await startServer(client, { accessKey: '' });

  try {
    const response = await fetch(`${disabled.baseUrl}/api/gm/agencies`, {
      headers: gmHeaders(),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'GM_DISABLED');
  } finally {
    await new Promise((resolve) => disabled.server.close(resolve));
  }

  const enabled = await startServer(client);
  try {
    const response = await fetch(`${enabled.baseUrl}/api/gm/agencies`, {
      headers: gmHeaders('wrong-key'),
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'GM_UNAUTHORIZED');
    assert.equal(database.agencies.length, 2);
  } finally {
    await new Promise((resolve) => enabled.server.close(resolve));
  }
});

test('GM state returns only pending events for the selected agency', async () => {
  const { client } = createFakeSupabase(createDatabase());
  const { server, baseUrl } = await startServer(client);

  try {
    const response = await fetch(`${baseUrl}/api/gm/state?agencyId=agency-1`, {
      headers: gmHeaders(),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.agency.id, 'agency-1');
    assert.equal(body.season.id, 'season-1');
    assert.equal(body.vehicles.length, 1);
    assert.deepEqual(body.events.map((event) => event.id), ['ev-dip', 'ev-op-1', 'ev-op-2']);
    assert.ok(body.events.every((event) => event.status === 'PENDING'));
    assert.ok(body.operationEventTypes.includes('PRODUCTION_COMPLETE'));
    assert.equal(body.scope, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GM advance shifts operations earlier and preserves their order', async () => {
  const { database, client } = createFakeSupabase(createDatabase());
  const { server, baseUrl } = await startServer(client);

  try {
    const response = await fetch(`${baseUrl}/api/gm/advance`, {
      method: 'POST',
      headers: gmHeaders(),
      body: JSON.stringify({ agencyId: 'agency-1', gameDays: 30 }),
    });
    const body = await response.json();

    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.updated, 2);
    assert.equal(body.mode, 'shift');
    assert.equal(body.scope, 'operations');

    const byId = Object.fromEntries(
      database.scheduled_events.map((event) => [event.id, event]),
    );
    assert.ok(new Date(byId['ev-op-1'].execute_at) < FIXED_NOW);
    assert.ok(new Date(byId['ev-op-2'].execute_at) < FIXED_NOW);
    assert.ok(new Date(byId['ev-op-1'].execute_at) < new Date(byId['ev-op-2'].execute_at));
    assert.equal(byId['ev-dip'].execute_at, '2026-11-16T01:00:00.000Z');
    assert.equal(byId['ev-done'].execute_at, '2026-11-15T00:00:00.000Z');

    const audit = database.audit_events.find((event) => event.action === 'GM_ADVANCE_TIME');
    assert.ok(audit, 'advance should be audited');
    assert.equal(audit.actor_type, 'gm');
    assert.equal(audit.agency_id, 'agency-1');
    assert.equal(audit.metadata.updated, 2);
    assert.deepEqual(audit.metadata.eventIds, ['ev-op-1', 'ev-op-2']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GM audit endpoint returns recorded events with filters', async () => {
  const { database, client } = createFakeSupabase(createDatabase());
  const { server, baseUrl } = await startServer(client);

  try {
    await fetch(`${baseUrl}/api/gm/advance`, {
      method: 'POST',
      headers: gmHeaders(),
      body: JSON.stringify({ agencyId: 'agency-1', gameDays: 30 }),
    });

    const response = await fetch(`${baseUrl}/api/gm/audit?agencyId=agency-1&action=GM_ADVANCE_TIME`, {
      headers: gmHeaders(),
    });
    const body = await response.json();

    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.events.length, 1);
    assert.equal(body.events[0].action, 'GM_ADVANCE_TIME');
    assert.equal(database.audit_events.length, 1);

    const unauthorized = await fetch(`${baseUrl}/api/gm/audit`, {
      headers: gmHeaders('wrong-key'),
    });
    assert.equal(unauthorized.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GM complete-now mode flushes every event in scope', async () => {
  const { database, client } = createFakeSupabase(createDatabase());
  const { server, baseUrl } = await startServer(client);

  try {
    const response = await fetch(`${baseUrl}/api/gm/advance`, {
      method: 'POST',
      headers: gmHeaders(),
      body: JSON.stringify({ agencyId: 'agency-1', mode: 'now', scope: 'all' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.updated, 3);
    assert.equal(body.mode, 'now');

    for (const id of ['ev-dip', 'ev-op-1', 'ev-op-2']) {
      const event = database.scheduled_events.find((candidate) => candidate.id === id);
      assert.ok(new Date(event.execute_at) <= FIXED_NOW, `${id} should be due`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GM advance validates the requested duration', async () => {
  const { client } = createFakeSupabase(createDatabase());
  const { server, baseUrl } = await startServer(client);

  try {
    const response = await fetch(`${baseUrl}/api/gm/advance`, {
      method: 'POST',
      headers: gmHeaders(),
      body: JSON.stringify({ agencyId: 'agency-1', gameDays: 0 }),
    });
    assert.equal(response.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
