const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createFakeSupabase } = require('../test-support/fakeSupabase');
const personnelRoutes = require('../src/routes/personnel');

const season = {
  id: 'season-1',
  name: 'Season 1 - 1969',
  start_real_time: '2026-11-16T00:00:00.000Z',
  epoch_game_date: '1969-07-20',
  time_scale_multiplier: 52.142857,
  status: 'ACTIVE',
};

function createDatabase(overrides = {}) {
  return {
    seasons: [season],
    agencies: [{
      id: 'agency-1',
      season_id: 'season-1',
      user_id: 'user-1',
      controller_type: 'player',
      funding_usd: 15000000,
    }],
    agency_crew: [
      {
        id: 'crew-1',
        agency_id: 'agency-1',
        name: 'Ada West',
        role: 'COMMANDER',
        status: 'ACTIVE',
        experience: 2,
        missions_flown: 1,
        salary_usd: 150000,
      },
    ],
    mission_crew: [],
    mission_investigations: [],
    missions: [],
    scheduled_events: [],
    logs: [],
    audit_events: [],
    ...overrides,
  };
}

function authenticate(req, _res, next) {
  req.authUser = { id: 'user-1' };
  next();
}

async function startServer(client) {
  const app = express();
  app.use(express.json());
  app.use('/api/personnel', personnelRoutes(client, { authenticate }));

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

function missingTableClient(base, tables) {
  const missingQuery = () => {
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      order: () => query,
      limit: () => query,
      maybeSingle: () => query,
      then: (resolve) => resolve({
        data: null,
        error: {
          code: 'PGRST205',
          message: "Could not find the table in the schema cache",
        },
      }),
    };
    return query;
  };
  return {
    from(table) {
      return tables.has(table) ? missingQuery() : base.from(table);
    },
    rpc: (...args) => base.rpc(...args),
  };
}

test('personnel overview returns the roster, payroll, and open investigations', async () => {
  const database = createDatabase({
    mission_investigations: [{
      id: 'inv-1',
      agency_id: 'agency-1',
      mission_id: 'mission-1',
      mission_name: 'Fallen Probe',
      stage: 'ORBIT_INSERTION',
      status: 'OPEN',
      cost_usd: 200000,
    }],
  });
  const { client } = createFakeSupabase(database);
  const { server, baseUrl } = await startServer(client);

  try {
    const response = await fetch(`${baseUrl}/api/personnel/agency-1`);
    const body = await response.json();

    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.migration_required, false);
    assert.equal(body.counts.total, 1);
    assert.equal(body.payroll.total_usd, 150000);
    assert.equal(body.investigations.length, 1);
    assert.equal(body.investigations[0].stage, 'ORBIT_INSERTION');
    assert.equal(body.investigations_migration_required, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('recruit endpoint charges funding and queues training automatically', async () => {
  const database = createDatabase();
  const { client } = createFakeSupabase(database);
  const { server, baseUrl } = await startServer(client);

  try {
    const created = await postJson(baseUrl, '/api/personnel/recruit', {
      agencyId: 'agency-1',
      name: 'Yuri Vega',
      role: 'PILOT',
    });

    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.new_funding_usd, 14700000);
    assert.equal(database.agencies[0].funding_usd, 14700000);
    assert.equal(
      database.scheduled_events.filter(
        (row) => row.event_type === 'CREW_TRAINING_COMPLETE',
      ).length,
      1,
    );

    const invalid = await postJson(baseUrl, '/api/personnel/recruit', {
      agencyId: 'agency-1',
      name: 'Yuri Vega II',
      role: 'JANITOR',
    });
    assert.equal(invalid.response.status, 400, JSON.stringify(invalid.body));
    assert.equal(database.agencies[0].funding_usd, 14700000);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('investigation start endpoint is scoped to open investigations', async () => {
  const database = createDatabase({
    mission_investigations: [{
      id: 'inv-1',
      agency_id: 'agency-1',
      mission_id: 'mission-1',
      mission_name: 'Fallen Probe',
      stage: 'ORBIT_INSERTION',
      status: 'OPEN',
      cost_usd: 200000,
    }],
  });
  const { client } = createFakeSupabase(database);
  const { server, baseUrl } = await startServer(client);

  try {
    const started = await postJson(baseUrl, '/api/personnel/investigations/start', {
      agencyId: 'agency-1',
      missionId: 'mission-1',
    });
    assert.equal(started.response.status, 202, JSON.stringify(started.body));
    assert.equal(started.body.new_funding_usd, 14800000);
    assert.equal(database.mission_investigations[0].status, 'IN_PROGRESS');

    const repeat = await postJson(baseUrl, '/api/personnel/investigations/start', {
      agencyId: 'agency-1',
      missionId: 'mission-1',
    });
    assert.equal(repeat.response.status, 409, JSON.stringify(repeat.body));
    assert.equal(database.agencies[0].funding_usd, 14800000);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('personnel endpoints report migration-required before 015 is applied', async () => {
  const database = createDatabase();
  const { client: base } = createFakeSupabase(database);
  const client = missingTableClient(
    base,
    new Set(['agency_crew', 'mission_crew', 'mission_investigations']),
  );
  const { server, baseUrl } = await startServer(client);

  try {
    const response = await fetch(`${baseUrl}/api/personnel/agency-1`);
    const body = await response.json();

    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.migration_required, true);
    assert.deepEqual(body.crew, []);
    assert.equal(body.investigations_migration_required, true);
    assert.equal(body.payroll.total_usd, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
