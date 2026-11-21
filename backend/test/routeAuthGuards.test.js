const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createFakeSupabase } = require('../test-support/fakeSupabase');
const agencyRoutes = require('../src/routes/agency');
const researchRoutes = require('../src/routes/research');
const productionRoutes = require('../src/routes/production');
const orbitRoutes = require('../src/routes/orbit');
const dashboardRoutes = require('../src/routes/dashboard');
const calendarRoutes = require('../src/routes/calendar');
const personnelRoutes = require('../src/routes/personnel');

function createDatabase() {
  return {
    agencies: [{
      id: 'agency-1',
      user_id: 'user-1',
      controller_type: 'player',
      name: 'Guard Test Agency',
    }],
    seasons: [],
    logs: [],
    vehicles: [],
    missions: [],
    technologies: [],
    agency_tech_nodes: [],
  };
}

function createClient(database) {
  const { client } = createFakeSupabase(database);
  return {
    ...client,
    auth: {
      getUser: async (token) => {
        if (token === 'user-2-token') {
          return { data: { user: { id: 'user-2' } }, error: null };
        }
        return { data: { user: { id: 'user-1' } }, error: null };
      },
    },
  };
}

async function startServer(client, deps = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/agency', agencyRoutes(client, deps.agency || {}));
  app.use('/api/research', researchRoutes(client));
  app.use('/api/production', productionRoutes(client));
  app.use('/api/orbit', orbitRoutes(client));
  app.use('/api/dashboard', dashboardRoutes(client));
  app.use('/api/calendar', calendarRoutes(client));
  app.use('/api/personnel', personnelRoutes(client));

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

const agencyScopedRequests = [
  ['PATCH', '/api/agency/agency-1/profile', {}],
  ['POST', '/api/research/start', { agencyId: 'agency-1', nodeId: 'rocketry-1' }],
  ['POST', '/api/research/static-fire', { agencyId: 'agency-1', nodeId: 'rocketry-1' }],
  ['GET', '/api/research/available/agency-1', null],
  ['POST', '/api/production/vehicle', { agencyId: 'agency-1', vehicleName: 'X', vehicleType: 'probe' }],
  ['PATCH', '/api/production/vehicle/vehicle-1/performance', { agencyId: 'agency-1', delta_v_budget_m_s: 2000 }],
  ['GET', '/api/orbit/overview/agency-1', null],
  ['GET', '/api/dashboard/agency-1', null],
  ['GET', '/api/personnel/agency-1', null],
  ['POST', '/api/personnel/recruit', { agencyId: 'agency-1', name: 'Guard Crew', role: 'PILOT' }],
  ['POST', '/api/personnel/investigations/start', { agencyId: 'agency-1', missionId: 'mission-1' }],
];

async function request(baseUrl, method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
  });
}

test('agency, research, production, orbit, dashboard, calendar, and personnel reject missing tokens', async () => {
  const client = createClient(createDatabase());
  const { server, baseUrl } = await startServer(client);

  try {
    const requests = [
      ...agencyScopedRequests,
      ['GET', '/api/agency/user-1', null],
      ['GET', '/api/agency/', null],
      ['GET', '/api/dashboard/ranking/global', null],
      ['GET', '/api/calendar', null],
    ];

    for (const [method, path, body] of requests) {
      const response = await request(baseUrl, method, path, body);
      const payload = await response.json();
      assert.equal(response.status, 401, `${method} ${path}: ${JSON.stringify(payload)}`);
      assert.equal(payload.error, 'AUTH_REQUIRED', `${method} ${path}`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('agency-scoped routes reject authenticated users who do not own the agency', async () => {
  const client = createClient(createDatabase());
  const { server, baseUrl } = await startServer(client);

  try {
    for (const [method, path, body] of agencyScopedRequests) {
      const response = await request(baseUrl, method, path, body, 'user-2-token');
      const payload = await response.json();
      assert.equal(response.status, 403, `${method} ${path}: ${JSON.stringify(payload)}`);
      assert.equal(payload.error, 'FORBIDDEN_AGENCY', `${method} ${path}`);
    }

    const ownUser = await request(baseUrl, 'GET', '/api/agency/user-1', null, 'user-2-token');
    assert.equal(ownUser.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('update-stats requires the GM key instead of a player session', async () => {
  const database = createDatabase();
  const client = createClient(database);
  const { server, baseUrl } = await startServer(client, {
    agency: { gmAccessKey: 'test-gm-key' },
  });

  try {
    const denied = await fetch(`${baseUrl}/api/agency/agency-1/update-stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ funding_usd: 123 }),
    });
    const deniedBody = await denied.json();
    assert.equal(denied.status, 401);
    assert.equal(deniedBody.error, 'GM_UNAUTHORIZED');
    assert.notEqual(database.agencies[0].funding_usd, 123);

    const allowed = await fetch(`${baseUrl}/api/agency/agency-1/update-stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gm-key': 'test-gm-key' },
      body: JSON.stringify({ funding_usd: 123 }),
    });
    const allowedBody = await allowed.json();
    assert.equal(allowed.status, 200, JSON.stringify(allowedBody));
    assert.equal(database.agencies[0].funding_usd, 123);

    const audit = database.audit_events.find((event) => event.action === 'GM_UPDATE_STATS');
    assert.ok(audit, 'update-stats should be audited');
    assert.equal(audit.actor_type, 'gm');
    assert.equal(audit.after_data.funding_usd, 123);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
