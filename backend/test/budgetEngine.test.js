const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase } = require('../test-support/fakeSupabase');
const { economyRpc } = require('../test-support/economyRpc');
const {
  calculateAnnualAppropriation,
  calculateOperatingCost,
  calculateVehicleUpkeep,
  calculateAnnualBudget,
  nextBudgetBoundary,
  ensureBudgetSchedules,
  handleBudgetReview,
  getBudgetOverview,
} = require('../src/services/budgetEngine');

const season = {
  id: 'season-1',
  name: 'Season 1 - 1969',
  start_real_time: '2026-11-16T00:00:00.000Z',
  epoch_game_date: '1969-07-20',
  time_scale_multiplier: 52.142857,
  status: 'ACTIVE',
};

function createAgency(overrides = {}) {
  return {
    id: 'agency-1',
    season_id: 'season-1',
    user_id: 'user-1',
    controller_type: 'player',
    is_active: true,
    name: 'Budget Test Agency',
    alignment: 'WESTERN',
    ipi: 60,
    si: 70,
    total_engineers: 30,
    funding_usd: 15000000,
    ...overrides,
  };
}

function createDatabase(overrides = {}) {
  return {
    seasons: [season],
    agencies: [createAgency()],
    vehicles: [
      { id: 'vehicle-1', agency_id: 'agency-1', type: 'orbital-rocket', status: 'testing' },
      { id: 'vehicle-2', agency_id: 'agency-1', type: 'satellite', status: 'testing' },
      { id: 'vehicle-3', agency_id: 'agency-1', type: 'orbital-rocket', status: 'manufacturing' },
    ],
    scheduled_events: [],
    logs: [],
    audit_events: [],
    agency_budget_cycles: [],
    ...overrides,
  };
}

test('annual budget combines appropriation, personnel, HQ, and vehicle upkeep', () => {
  const agency = createAgency();
  const vehicles = createDatabase().vehicles;

  const appropriation = calculateAnnualAppropriation(agency);
  assert.equal(appropriation.base_usd, 4000000);
  assert.equal(appropriation.ipi_component_usd, 2400000);
  assert.equal(appropriation.si_component_usd, 1400000);
  assert.equal(appropriation.alignment_multiplier, 1.15);
  assert.equal(appropriation.total_usd, 8970000);

  const operating = calculateOperatingCost(agency);
  assert.equal(operating.engineers, 30);
  assert.equal(operating.personnel_usd, 1800000);
  assert.equal(operating.total_usd, 3000000);

  const upkeep = calculateVehicleUpkeep(vehicles);
  assert.equal(upkeep.vehicle_count, 2);
  assert.equal(upkeep.total_usd, 360000);

  const budget = calculateAnnualBudget(agency, vehicles);
  assert.equal(budget.total_cost_usd, 3360000);
  assert.equal(budget.net_usd, 5610000);
});

test('independent agencies receive no bloc multiplier and unknown types use default upkeep', () => {
  const agency = createAgency({ alignment: 'INDEPENDENT', ipi: 0, si: 0, total_engineers: 0 });
  const upkeep = calculateVehicleUpkeep([
    { type: 'experimental-craft', status: 'testing' },
  ]);

  const appropriation = calculateAnnualAppropriation(agency);
  assert.equal(appropriation.total_usd, 4000000);
  assert.equal(upkeep.total_usd, 100000);
  assert.equal(calculateAnnualBudget(agency, []).net_usd, 2800000);
});

test('budget boundary targets the next ACD calendar year', () => {
  const boundary = nextBudgetBoundary(season, new Date('2026-11-21T00:00:00.000Z'));
  assert.equal(boundary.cycle_year, 1971);
  assert.equal(boundary.game_date, '1971-01-01');
});

test('bootstrap schedules one annual review per active player agency', async () => {
  const database = createDatabase();
  database.agencies.push(createAgency({
    id: 'npc-1',
    controller_type: 'npc',
    user_id: null,
    name: 'NPC Agency',
  }));
  const { client } = createFakeSupabase(database, { rpc: economyRpc(database) });

  const result = await ensureBudgetSchedules(client, {
    now: new Date('2026-11-21T00:00:00.000Z'),
  });

  assert.equal(result.scheduled, 1);
  assert.equal(database.scheduled_events.length, 1);
  assert.equal(database.scheduled_events[0].agency_id, 'agency-1');
  assert.equal(database.scheduled_events[0].event_type, 'BUDGET_REVIEW');
  assert.equal(database.scheduled_events[0].payload.cycle_year, 1971);
});

test('worker settles the annual budget, audits it, and schedules the next review', async () => {
  const database = createDatabase();
  const { client } = createFakeSupabase(database, { rpc: economyRpc(database) });
  const event = {
    id: 'event-1',
    agency_id: 'agency-1',
    season_id: 'season-1',
    event_type: 'BUDGET_REVIEW',
    reference_id: 'budget:agency-1:1971',
    payload: { cycle_year: 1971, game_date: '1971-01-01' },
    execute_at: '2026-11-27T00:00:00.000Z',
    status: 'PROCESSING',
  };
  database.scheduled_events.push(event);

  const result = await handleBudgetReview(client, event, {
    now: new Date('2026-11-27T00:00:00.000Z'),
  });

  assert.equal(result.status, 'APPLIED');
  assert.equal(result.cycle_year, 1971);
  assert.equal(result.appropriation_usd, 8970000);
  assert.equal(result.operating_cost_usd, 3000000);
  assert.equal(result.upkeep_usd, 360000);
  assert.equal(result.net_usd, 5610000);
  assert.equal(database.agencies[0].funding_usd, 20610000);
  assert.equal(database.agency_budget_cycles.length, 1);

  const log = database.logs.find((row) => row.event_type === 'BUDGET_REVIEW');
  assert.ok(log, 'annual review should write a log');
  assert.equal(log.data.net_usd, 5610000);

  const audit = database.audit_events.find((row) => row.action === 'ANNUAL_BUDGET_SETTLED');
  assert.ok(audit, 'annual review should be audited');
  assert.equal(audit.actor_type, 'system');
  assert.equal(audit.delta_data.funding_usd, 5610000);

  const next = database.scheduled_events.find(
    (row) => row.id !== event.id && row.event_type === 'BUDGET_REVIEW' && row.status === 'PENDING',
  );
  assert.ok(next, 'next annual review should be scheduled');
  assert.equal(next.payload.cycle_year, 1972);
});

test('annual settlement clamps funding at zero and records the unpaid deficit', async () => {
  const database = createDatabase({
    agencies: [createAgency({ funding_usd: 100000, total_engineers: 150 })],
  });
  const { client } = createFakeSupabase(database, { rpc: economyRpc(database) });
  const event = {
    id: 'event-1',
    agency_id: 'agency-1',
    season_id: 'season-1',
    event_type: 'BUDGET_REVIEW',
    payload: { cycle_year: 1971, game_date: '1971-01-01' },
    execute_at: '2026-11-27T00:00:00.000Z',
    status: 'PROCESSING',
  };
  database.scheduled_events.push(event);

  const result = await handleBudgetReview(client, event, {
    now: new Date('2026-11-27T00:00:00.000Z'),
  });

  assert.equal(result.status, 'DEFICIT');
  assert.equal(result.funding_after_usd, 0);
  assert.equal(result.unpaid_usd, 1490000);
  assert.equal(database.logs[0].event_type, 'BUDGET_DEFICIT');
  assert.equal(database.agencies[0].funding_usd, 0);
});

test('budget overview degrades to projections before migration 014 is applied', async () => {
  const database = createDatabase();
  const { client: base } = createFakeSupabase(database, { rpc: economyRpc(database) });
  const client = {
    ...base,
    from(table) {
      if (table !== 'agency_budget_cycles') return base.from(table);
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        then: (resolve) => resolve({
          data: null,
          error: {
            code: 'PGRST205',
            message: "Could not find the table 'public.agency_budget_cycles' in the schema cache",
          },
        }),
      };
      return query;
    },
    rpc: base.rpc,
  };

  const overview = await getBudgetOverview(client, database.agencies[0], {
    now: new Date('2026-11-21T00:00:00.000Z'),
  });

  assert.equal(overview.net_usd, 5610000);
  assert.equal(overview.history_migration_required, true);
  assert.deepEqual(overview.history, []);
  assert.equal(overview.next_review_game_date, '1971-01-01');
});
