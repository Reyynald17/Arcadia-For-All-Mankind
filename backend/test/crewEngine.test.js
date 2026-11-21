const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase } = require('../test-support/fakeSupabase');
const { calculateOperatingCost } = require('../src/services/budgetEngine');
const {
  CrewError,
  calculateCrewPayroll,
  loadAgencyCrew,
  getCrewOverview,
  recruitCrew,
  handleCrewTrainingComplete,
  selectMissionCrew,
  resolveMissionCrew,
} = require('../src/services/crewEngine');

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
    funding_usd: 15000000,
    ...overrides,
  };
}

function createDatabase(overrides = {}) {
  return {
    seasons: [season],
    agencies: [createAgency()],
    agency_crew: [],
    mission_crew: [],
    missions: [],
    vehicles: [],
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
      insert: () => query,
      update: () => query,
      delete: () => query,
      eq: () => query,
      in: () => query,
      order: () => query,
      limit: () => query,
      maybeSingle: () => query,
      single: () => query,
      then: (resolve) => resolve({
        data: null,
        error: {
          code: 'PGRST205',
          message: "Could not find the table 'public.agency_crew' in the schema cache",
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

test('crew payroll includes active, training, and injured staff only', () => {
  const rows = [
    { id: 'c1', role: 'COMMANDER', status: 'ACTIVE', salary_usd: 150000 },
    { id: 'c2', role: 'PILOT', status: 'TRAINING', salary_usd: 130000 },
    { id: 'c3', role: 'MISSION_SPECIALIST', status: 'INJURED', salary_usd: 110000 },
    { id: 'c4', role: 'PILOT', status: 'RETIRED', salary_usd: 130000 },
    { id: 'c5', role: 'PILOT', status: 'KILLED', salary_usd: 130000 },
  ];

  const payroll = calculateCrewPayroll(rows);
  assert.equal(payroll.crew_count, 3);
  assert.equal(payroll.total_usd, 390000);
  assert.deepEqual(payroll.by_role.map((line) => line.role), [
    'COMMANDER',
    'PILOT',
    'MISSION_SPECIALIST',
  ]);

  const operating = calculateOperatingCost({ total_engineers: 30 }, rows);
  assert.equal(operating.personnel_usd, 1800000);
  assert.equal(operating.crew_count, 3);
  assert.equal(operating.crew_payroll_usd, 390000);
  assert.equal(operating.total_usd, 3390000);
});

test('crew overview reports counts, payroll, and the role catalog', async () => {
  const database = createDatabase({
    agency_crew: [
      { id: 'c1', agency_id: 'agency-1', name: 'Ada West', role: 'COMMANDER', status: 'ACTIVE', salary_usd: 150000 },
      { id: 'c2', agency_id: 'agency-1', name: 'Bo Reyes', role: 'PILOT', status: 'TRAINING', salary_usd: 130000 },
      { id: 'c3', agency_id: 'agency-1', name: 'Cy Park', role: 'MISSION_SPECIALIST', status: 'INJURED', salary_usd: 110000 },
      { id: 'c4', agency_id: 'agency-1', name: 'Dee Moss', role: 'PILOT', status: 'KILLED', salary_usd: 130000 },
    ],
  });
  const { client } = createFakeSupabase(database);

  const overview = await getCrewOverview(client, 'agency-1');

  assert.equal(overview.migration_required, false);
  assert.deepEqual(overview.counts, {
    total: 4,
    active: 1,
    training: 1,
    injured: 1,
    killed: 1,
    retired: 0,
    assignable: 1,
  });
  assert.equal(overview.payroll.total_usd, 390000);
  assert.equal(overview.roles.length, 3);
  assert.equal(overview.training_game_days, 12);
});

test('recruit charges training cost, schedules completion, and activates the crew member', async () => {
  const database = createDatabase();
  const { client } = createFakeSupabase(database);
  const now = new Date('2026-11-21T00:00:00.000Z');

  const result = await recruitCrew(client, {
    agency: database.agencies[0],
    name: 'Valentina Cross',
    role: 'COMMANDER',
    now,
  });

  assert.equal(result.training_cost_usd, 350000);
  assert.equal(result.new_funding_usd, 14650000);
  assert.equal(database.agencies[0].funding_usd, 14650000);
  assert.equal(database.agency_crew.length, 1);
  assert.equal(database.agency_crew[0].status, 'TRAINING');
  assert.equal(database.agency_crew[0].salary_usd, 150000);

  const event = database.scheduled_events.find(
    (row) => row.event_type === 'CREW_TRAINING_COMPLETE',
  );
  assert.ok(event, 'training completion should be scheduled');
  assert.equal(event.reference_id, database.agency_crew[0].id);
  assert.ok(new Date(event.execute_at) > now);

  assert.equal(database.logs[0].event_type, 'CREW_RECRUITED');
  const audit = database.audit_events.find((row) => row.action === 'CREW_RECRUITED');
  assert.ok(audit, 'recruitment should be audited');
  assert.equal(audit.delta_data.funding_usd, -350000);

  const activation = await handleCrewTrainingComplete(client, event);
  assert.equal(activation.already_completed, false);
  assert.equal(database.agency_crew[0].status, 'ACTIVE');
  assert.equal(database.agency_crew[0].ready_at, event.execute_at);
  assert.ok(database.logs.find((row) => row.event_type === 'CREW_READY'));
  assert.ok(database.audit_events.find((row) => row.action === 'CREW_ACTIVATED'));

  const replay = await handleCrewTrainingComplete(client, event);
  assert.equal(replay.already_completed, true);
  assert.equal(
    database.logs.filter((row) => row.event_type === 'CREW_READY').length,
    1,
  );
});

test('recruit rejects invalid roles, names, and funding without writing', async () => {
  const database = createDatabase();
  const { client } = createFakeSupabase(database);

  await assert.rejects(
    recruitCrew(client, { agency: database.agencies[0], name: 'Valid Name', role: 'JANITOR' }),
    (error) => error instanceof CrewError && error.status === 400,
  );
  await assert.rejects(
    recruitCrew(client, { agency: database.agencies[0], name: 'X', role: 'PILOT' }),
    (error) => error instanceof CrewError && error.status === 400,
  );

  const brokeAgency = createAgency({ id: 'agency-2', funding_usd: 100000 });
  database.agencies.push(brokeAgency);
  await assert.rejects(
    recruitCrew(client, { agency: brokeAgency, name: 'Cheap Hire', role: 'MISSION_SPECIALIST' }),
    (error) => error instanceof CrewError && error.status === 400,
  );

  assert.equal(database.agency_crew.length, 0);
  assert.equal(database.agencies[0].funding_usd, 15000000);
  assert.equal(database.scheduled_events.length, 0);
});

test('personnel data degrades gracefully before migration 015', async () => {
  const database = createDatabase();
  const { client: base } = createFakeSupabase(database);
  const client = missingTableClient(base, new Set(['agency_crew', 'mission_crew']));

  const loaded = await loadAgencyCrew(client, 'agency-1');
  assert.deepEqual(loaded, { rows: [], migration_required: true });

  const overview = await getCrewOverview(client, 'agency-1');
  assert.equal(overview.migration_required, true);
  assert.deepEqual(overview.crew, []);
  assert.equal(overview.payroll.total_usd, 0);

  await assert.rejects(
    recruitCrew(client, {
      agency: database.agencies[0],
      name: 'Lost Candidate',
      role: 'PILOT',
    }),
    (error) => error instanceof CrewError && error.status === 503,
  );
  assert.equal(database.agencies[0].funding_usd, 15000000);
});

test('standard crew selection prioritises role order and experience', () => {
  const rows = [
    { id: 's1', name: 'Specialist Ace', role: 'MISSION_SPECIALIST', status: 'ACTIVE', experience: 5, missions_flown: 2 },
    { id: 'p1', name: 'Pilot Rookie', role: 'PILOT', status: 'ACTIVE', experience: 0, missions_flown: 0 },
    { id: 'p2', name: 'Pilot Vet', role: 'PILOT', status: 'ACTIVE', experience: 3, missions_flown: 1 },
    { id: 'p3', name: 'Pilot Trainee', role: 'PILOT', status: 'TRAINING', experience: 9, missions_flown: 0 },
    { id: 'c1', name: 'Commander One', role: 'COMMANDER', status: 'ACTIVE', experience: 1, missions_flown: 1 },
  ];

  const selected = selectMissionCrew(rows, 3);
  assert.deepEqual(selected.map((row) => row.id), ['c1', 'p2', 'p1']);
  assert.deepEqual(
    selectMissionCrew(rows, 4).map((row) => row.id),
    ['c1', 'p2', 'p1', 's1'],
  );
  assert.deepEqual(selectMissionCrew(rows, 0), []);
});

test('mission crew resolution records deaths, survivors, and flight counts', async () => {
  const makeCrew = () => [
    { id: 'c1', agency_id: 'agency-1', name: 'Commander One', role: 'COMMANDER', status: 'ACTIVE', experience: 2, missions_flown: 3 },
    { id: 'c2', agency_id: 'agency-1', name: 'Pilot One', role: 'PILOT', status: 'ACTIVE', experience: 1, missions_flown: 2 },
    { id: 'c3', agency_id: 'agency-1', name: 'Specialist One', role: 'MISSION_SPECIALIST', status: 'ACTIVE', experience: 0, missions_flown: 1 },
  ];
  const database = createDatabase({
    agency_crew: makeCrew(),
    mission_crew: makeCrew().map((row) => ({
      mission_id: 'mission-1',
      crew_id: row.id,
      agency_id: 'agency-1',
      role: row.role,
      outcome: 'ASSIGNED',
    })),
  });
  const { client } = createFakeSupabase(database);

  const result = await resolveMissionCrew(client, 'mission-1', {
    success: false,
    crewDeaths: 1,
    now: new Date('2026-11-21T00:00:00.000Z'),
  });

  assert.equal(result.assignments, 3);
  assert.equal(result.survived, 2);
  assert.equal(result.killed, 1);
  assert.equal(database.agency_crew[0].status, 'KILLED');
  assert.equal(database.agency_crew[0].missions_flown, 4);
  assert.equal(database.agency_crew[1].status, 'ACTIVE');
  assert.equal(database.agency_crew[1].experience, 1);
  assert.deepEqual(
    database.agency_crew.map((row) => row.missions_flown),
    [4, 3, 2],
  );
  assert.deepEqual(
    database.mission_crew.map((row) => row.outcome),
    ['KILLED', 'SURVIVED', 'SURVIVED'],
  );

  const audit = database.audit_events.find((row) => row.action === 'MISSION_CREW_RESOLVED');
  assert.ok(audit, 'crew resolution should be audited');
  assert.equal(audit.after_data.killed, 1);

  const casualties = database.logs.filter((row) => row.event_type === 'CREW_KILLED');
  assert.equal(casualties.length, 1);
  assert.equal(casualties[0].data.crew_name, 'Commander One');
  assert.equal(casualties[0].data.role, 'COMMANDER');
  assert.equal(casualties[0].data.mission_id, 'mission-1');

  const successDatabase = createDatabase({
    agency_crew: makeCrew(),
    mission_crew: makeCrew().map((row) => ({
      mission_id: 'mission-2',
      crew_id: row.id,
      agency_id: 'agency-1',
      role: row.role,
      outcome: 'ASSIGNED',
    })),
  });
  const { client: successClient } = createFakeSupabase(successDatabase);

  await resolveMissionCrew(successClient, 'mission-2', { success: true, crewDeaths: 0 });

  assert.deepEqual(
    successDatabase.agency_crew.map((row) => row.experience),
    [3, 2, 1],
  );
  assert.deepEqual(
    successDatabase.agency_crew.map((row) => row.status),
    ['ACTIVE', 'ACTIVE', 'ACTIVE'],
  );
  assert.equal(
    successDatabase.logs.filter((row) => row.event_type === 'CREW_KILLED').length,
    0,
  );
});
