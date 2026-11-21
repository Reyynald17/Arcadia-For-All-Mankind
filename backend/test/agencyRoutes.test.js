const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createFakeSupabase } = require('../test-support/fakeSupabase');
const agencyRoutes = require('../src/routes/agency');
const dashboardRoutes = require('../src/routes/dashboard');

function createDatabase() {
  return {
    agencies: [{
      id: 'agency-1',
      user_id: 'user-1',
      controller_type: 'player',
      name: 'Valoria Test',
      country: 'Valoria',
      alignment: 'INDEPENDENT',
      bloc: 'neutral',
      launch_site_lat: 0,
      launch_site_lon: 0,
      launch_site_name: null,
      profile_complete: false,
      alignment_locked_at: null,
      science_points: 50,
      funding_usd: 15000000,
      rp: 0,
      si: 70,
      ipi: 60,
      slr: 0,
    }],
    missions: [{
      id: 'mission-1',
      agency_id: 'agency-1',
      name: 'Test Flight',
      status: 'PLANNED',
      scheduled_launch_at: '2026-11-20T00:00:00.000Z',
    }],
    logs: [],
    vehicles: [],
  };
}

async function startServer(client) {
  const app = express();
  app.use(express.json());
  app.use('/api/agency', agencyRoutes(client));
  app.use('/api/dashboard', dashboardRoutes(client));

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

const completeProfile = {
  alignment: 'WESTERN',
  launchSiteName: 'Cape Meridian',
  launchSiteLat: 5.24,
  launchSiteLon: -52.77,
};

test('PATCH profile completes onboarding for the owning user', async () => {
  const { database, client } = createFakeSupabase(createDatabase(), { userId: 'user-1' });
  const { server, baseUrl } = await startServer(client);

  try {
    const response = await fetch(`${baseUrl}/api/agency/agency-1/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify(completeProfile),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.agency.alignment, 'WESTERN');
    assert.equal(body.agency.bloc, 'western');
    assert.equal(body.agency.profile_complete, true);
    assert.ok(body.agency.alignment_locked_at);
    assert.equal(database.agencies[0].launch_site_name, 'Cape Meridian');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('PATCH profile rejects users who do not own the agency', async () => {
  const { database, client } = createFakeSupabase(createDatabase(), { userId: 'user-2' });
  const { server, baseUrl } = await startServer(client);

  try {
    const response = await fetch(`${baseUrl}/api/agency/agency-1/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify(completeProfile),
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.error, 'FORBIDDEN_AGENCY');
    assert.equal(database.agencies[0].profile_complete, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('PATCH profile refuses to change a locked alignment', async () => {
  const database = createDatabase();
  database.agencies[0].profile_complete = true;
  database.agencies[0].alignment = 'WESTERN';
  database.agencies[0].bloc = 'western';
  database.agencies[0].alignment_locked_at = '2026-11-01T00:00:00.000Z';
  const { client } = createFakeSupabase(database, { userId: 'user-1' });
  const { server, baseUrl } = await startServer(client);

  try {
    const response = await fetch(`${baseUrl}/api/agency/agency-1/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ ...completeProfile, alignment: 'EASTERN' }),
    });
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.error, 'ALIGNMENT_LOCKED');
    assert.equal(database.agencies[0].alignment, 'WESTERN');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('PATCH profile rejects an incomplete payload', async () => {
  const { client } = createFakeSupabase(createDatabase(), { userId: 'user-1' });
  const { server, baseUrl } = await startServer(client);

  try {
    const response = await fetch(`${baseUrl}/api/agency/agency-1/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ alignment: 'WESTERN' }),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, 'INVALID_PROFILE');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('agency dashboard orders missions by scheduled launch time', async () => {
  const { database, client: baseClient } = createFakeSupabase(createDatabase());
  database.vehicles.push({
    id: 'vehicle-1',
    agency_id: 'agency-1',
    name: 'Orbiter One',
    type: 'orbital-rocket',
  });
  const orders = [];
  const client = {
    ...baseClient,
    from(table) {
      const query = baseClient.from(table);
      const order = query.order.bind(query);
      query.order = (column, options) => {
        orders.push({ table, column, options });
        return order(column, options);
      };
      return query;
    },
  };
  const { server, baseUrl } = await startServer(client);

  try {
    const response = await fetch(`${baseUrl}/api/dashboard/agency-1`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.vehicles[0].performance_defaults.delta_v_budget_m_s, 9450);
    assert.equal(body.annualBudget.net_usd, 6360000);
    assert.equal(body.missions.length, 1);
    assert.equal(body.missions[0].id, 'mission-1');
    assert.ok(orders.some(
      (entry) => entry.table === 'missions' && entry.column === 'scheduled_launch_at',
    ));
    assert.ok(!orders.some(
      (entry) => entry.table === 'missions' && entry.column === 'created_at',
    ));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
