const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase } = require('../test-support/fakeSupabase');
const {
  STAGE_CAUSES,
  InvestigationError,
  listInvestigations,
  createInvestigationIfMissing,
  startInvestigation,
  handleInvestigationComplete,
} = require('../src/services/investigationEngine');

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
    missions: [{
      id: 'mission-1',
      agency_id: 'agency-1',
      season_id: 'season-1',
      vehicle_id: 'vehicle-1',
      name: 'Fallen Probe',
      type: 'scientific',
      status: 'FAILED',
    }],
    vehicles: [{ id: 'vehicle-1', agency_id: 'agency-1', reliability: 80 }],
    mission_investigations: [],
    scheduled_events: [],
    logs: [],
    audit_events: [],
    ...overrides,
  };
}

function missingTableClient(base, tables) {
  const missingQuery = () => {
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      order: () => query,
      limit: () => query,
      upsert: () => query,
      maybeSingle: () => query,
      then: (resolve) => resolve({
        data: null,
        error: {
          code: 'PGRST205',
          message: "Could not find the table 'public.mission_investigations' in the schema cache",
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

test('a failed mission opens exactly one investigation', async () => {
  const database = createDatabase();
  const { client } = createFakeSupabase(database);
  const now = new Date('2026-11-21T00:00:00.000Z');

  const first = await createInvestigationIfMissing(client, {
    mission: database.missions[0],
    stage: 'ORBIT_INSERTION',
    now,
  });
  assert.ok(first, 'investigation should be created');
  assert.equal(first.status, 'OPEN');
  assert.equal(first.stage, 'ORBIT_INSERTION');
  assert.equal(first.cost_usd, 200000);
  assert.equal(first.mission_name, 'Fallen Probe');

  await createInvestigationIfMissing(client, {
    mission: database.missions[0],
    stage: 'ORBIT_INSERTION',
    now,
  });
  assert.equal(database.mission_investigations.length, 1);
});

test('starting an investigation charges funding and schedules completion once', async () => {
  const database = createDatabase();
  const { client } = createFakeSupabase(database);
  const now = new Date('2026-11-21T00:00:00.000Z');

  await createInvestigationIfMissing(client, {
    mission: database.missions[0],
    stage: 'ORBIT_INSERTION',
    now,
  });

  const result = await startInvestigation(client, {
    agency: database.agencies[0],
    missionId: 'mission-1',
    now,
  });

  assert.equal(result.investigation.status, 'IN_PROGRESS');
  assert.equal(result.cost_usd, 200000);
  assert.equal(result.new_funding_usd, 14800000);
  assert.equal(database.agencies[0].funding_usd, 14800000);

  const event = database.scheduled_events.find(
    (row) => row.event_type === 'INVESTIGATION_COMPLETE',
  );
  assert.ok(event, 'completion should be scheduled');
  assert.ok(new Date(event.execute_at) > now);
  assert.ok(database.logs.find((row) => row.event_type === 'INVESTIGATION_STARTED'));

  const audit = database.audit_events.find((row) => row.action === 'INVESTIGATION_STARTED');
  assert.ok(audit, 'investigation start should be audited');
  assert.equal(audit.delta_data.funding_usd, -200000);

  await assert.rejects(
    startInvestigation(client, {
      agency: database.agencies[0],
      missionId: 'mission-1',
      now,
    }),
    (error) => error instanceof InvestigationError && error.status === 409,
  );
  assert.equal(database.agencies[0].funding_usd, 14800000);
});

test('completion applies a deterministic reliability bonus exactly once', async () => {
  const buildRunningDatabase = () => createDatabase({
    mission_investigations: [{
      id: 'inv-1',
      agency_id: 'agency-1',
      mission_id: 'mission-1',
      season_id: 'season-1',
      mission_name: 'Fallen Probe',
      stage: 'ORBIT_INSERTION',
      status: 'IN_PROGRESS',
      cost_usd: 200000,
      started_at: '2026-11-21T00:00:00.000Z',
      completes_at: '2026-11-22T00:00:00.000Z',
    }],
    scheduled_events: [{
      id: 'event-inv-1',
      agency_id: 'agency-1',
      season_id: 'season-1',
      event_type: 'INVESTIGATION_COMPLETE',
      reference_id: 'inv-1',
      execute_at: '2026-11-22T00:00:00.000Z',
      status: 'PROCESSING',
    }],
  });

  const database = buildRunningDatabase();
  const { client } = createFakeSupabase(database);
  const event = database.scheduled_events[0];

  const result = await handleInvestigationComplete(client, event);

  assert.equal(result.already_completed, false);
  assert.equal(database.mission_investigations[0].status, 'COMPLETED');
  assert.ok(STAGE_CAUSES.ORBIT_INSERTION.includes(result.cause));
  assert.ok(result.reliability_bonus >= 2 && result.reliability_bonus <= 6);
  assert.equal(result.vehicle_reliability_before, 80);
  assert.equal(
    database.vehicles[0].reliability,
    80 + result.reliability_bonus,
  );
  assert.ok(database.logs.find((row) => row.event_type === 'INVESTIGATION_COMPLETED'));
  const audit = database.audit_events.find((row) => row.action === 'INVESTIGATION_COMPLETED');
  assert.ok(audit, 'investigation completion should be audited');
  assert.equal(audit.metadata.reliability_bonus, result.reliability_bonus);

  const replay = await handleInvestigationComplete(client, event);
  assert.equal(replay.already_completed, true);
  assert.equal(database.vehicles[0].reliability, 80 + result.reliability_bonus);
  assert.equal(
    database.logs.filter((row) => row.event_type === 'INVESTIGATION_COMPLETED').length,
    1,
  );

  const other = buildRunningDatabase();
  const { client: otherClient } = createFakeSupabase(other);
  const otherResult = await handleInvestigationComplete(otherClient, other.scheduled_events[0]);
  assert.equal(otherResult.cause, result.cause);
  assert.equal(otherResult.reliability_bonus, result.reliability_bonus);
});

test('investigations degrade gracefully before migration 015', async () => {
  const database = createDatabase();
  const { client: base } = createFakeSupabase(database);
  const client = missingTableClient(base, new Set(['mission_investigations']));

  const listed = await listInvestigations(client, 'agency-1');
  assert.deepEqual(listed, { items: [], migration_required: true });

  const created = await createInvestigationIfMissing(client, {
    mission: database.missions[0],
    stage: 'LAUNCH',
  });
  assert.equal(created, null);

  await assert.rejects(
    startInvestigation(client, {
      agency: database.agencies[0],
      missionId: 'mission-1',
    }),
    (error) => error instanceof InvestigationError && error.status === 503,
  );
  assert.equal(database.agencies[0].funding_usd, 15000000);
});
