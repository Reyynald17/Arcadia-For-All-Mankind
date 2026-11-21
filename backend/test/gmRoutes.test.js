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
      type: 'sounding-rocket',
      status: 'manufacturing',
      reliability: 70,
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

test('GM reliability override validates input, updates the vehicle, and audits the change', async () => {
  const { database, client } = createFakeSupabase(createDatabase());
  const { server, baseUrl } = await startServer(client);

  try {
    const response = await fetch(`${baseUrl}/api/gm/vehicles/vehicle-1/reliability`, {
      method: 'POST',
      headers: gmHeaders(),
      body: JSON.stringify({ reliability: 84, reason: 'playtest tune' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.previous_reliability, 70);
    assert.equal(body.reliability, 84);
    assert.equal(body.changed, true);
    assert.equal(body.vehicle.reliability, 84);
    assert.equal(database.vehicles[0].reliability, 84);

    const audit = database.audit_events.find((event) => event.action === 'GM_VEHICLE_RELIABILITY');
    assert.ok(audit, 'reliability override should be audited');
    assert.equal(audit.actor_type, 'gm');
    assert.equal(audit.agency_id, 'agency-1');
    assert.equal(audit.entity_type, 'vehicle');
    assert.equal(audit.entity_id, 'vehicle-1');
    assert.equal(audit.before_data.reliability, 70);
    assert.equal(audit.after_data.reliability, 84);
    assert.equal(audit.delta_data.reliability, 14);
    assert.equal(audit.metadata.reason, 'playtest tune');

    const repeat = await fetch(`${baseUrl}/api/gm/vehicles/vehicle-1/reliability`, {
      method: 'POST',
      headers: gmHeaders(),
      body: JSON.stringify({ reliability: 84 }),
    });
    const repeatBody = await repeat.json();
    assert.equal(repeat.status, 200);
    assert.equal(repeatBody.changed, false);
    assert.equal(database.audit_events.length, 1, 'no-op overrides should not add audit rows');

    for (const invalid of [101, -1, 55.5, 'abc', null]) {
      const bad = await fetch(`${baseUrl}/api/gm/vehicles/vehicle-1/reliability`, {
        method: 'POST',
        headers: gmHeaders(),
        body: JSON.stringify({ reliability: invalid }),
      });
      assert.equal(bad.status, 400, `reliability ${invalid} should be rejected`);
    }

    const missing = await fetch(`${baseUrl}/api/gm/vehicles/missing/reliability`, {
      method: 'POST',
      headers: gmHeaders(),
      body: JSON.stringify({ reliability: 50 }),
    });
    assert.equal(missing.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GM repair raises reliability, caps at 95, and skips no-op writes', async () => {
  const { database, client } = createFakeSupabase(createDatabase());
  const { server, baseUrl } = await startServer(client);

  try {
    const first = await fetch(`${baseUrl}/api/gm/vehicles/vehicle-1/repair`, {
      method: 'POST',
      headers: gmHeaders(),
      body: JSON.stringify({ bonus: 10, reason: 'post-investigation fix' }),
    });
    const firstBody = await first.json();

    assert.equal(first.status, 200, JSON.stringify(firstBody));
    assert.equal(firstBody.previous_reliability, 70);
    assert.equal(firstBody.reliability, 80);
    assert.equal(firstBody.applied, 10);
    assert.equal(firstBody.capped, false);
    assert.equal(database.vehicles[0].reliability, 80);

    database.vehicles[0].reliability = 92;
    const capped = await fetch(`${baseUrl}/api/gm/vehicles/vehicle-1/repair`, {
      method: 'POST',
      headers: gmHeaders(),
      body: JSON.stringify({}),
    });
    const cappedBody = await capped.json();

    assert.equal(capped.status, 200);
    assert.equal(cappedBody.previous_reliability, 92);
    assert.equal(cappedBody.reliability, 95);
    assert.equal(cappedBody.applied, 3);
    assert.equal(cappedBody.capped, true);

    const noop = await fetch(`${baseUrl}/api/gm/vehicles/vehicle-1/repair`, {
      method: 'POST',
      headers: gmHeaders(),
      body: JSON.stringify({ bonus: 5 }),
    });
    const noopBody = await noop.json();

    assert.equal(noop.status, 200);
    assert.equal(noopBody.applied, 0);
    assert.equal(noopBody.reliability, 95);
    assert.equal(database.vehicles[0].reliability, 95);

    const repairs = database.audit_events.filter((event) => event.action === 'GM_VEHICLE_REPAIRED');
    assert.equal(repairs.length, 2, 'only applied repairs should be audited');
    assert.equal(repairs[0].delta_data.reliability, 10);
    assert.equal(repairs[0].metadata.reason, 'post-investigation fix');
    assert.equal(repairs[1].delta_data.reliability, 3);
    assert.equal(repairs[1].metadata.requested_bonus, 5);
    assert.equal(repairs[1].metadata.cap, 95);

    for (const invalid of [0, 21, 2.5, 'abc']) {
      const bad = await fetch(`${baseUrl}/api/gm/vehicles/vehicle-1/repair`, {
        method: 'POST',
        headers: gmHeaders(),
        body: JSON.stringify({ bonus: invalid }),
      });
      assert.equal(bad.status, 400, `bonus ${invalid} should be rejected`);
    }

    const missing = await fetch(`${baseUrl}/api/gm/vehicles/missing/repair`, {
      method: 'POST',
      headers: gmHeaders(),
      body: JSON.stringify({ bonus: 5 }),
    });
    assert.equal(missing.status, 404);
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
