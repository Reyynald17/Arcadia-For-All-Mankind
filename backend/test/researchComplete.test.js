const test = require('node:test');
const assert = require('node:assert/strict');
const { handleTechComplete } = require('../src/services/researchEngine');

class FakeQuery {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.operation = null;
    this.patch = null;
    this.insertRows = null;
    this.filters = [];
    this.singleMode = null;
  }

  select() {
    if (this.operation !== 'update') this.operation = 'select';
    return this;
  }

  update(patch) {
    this.operation = 'update';
    this.patch = patch;
    return this;
  }

  insert(rows) {
    this.operation = 'insert';
    this.insertRows = rows;
    return this;
  }

  eq(column, value) {
    this.filters.push({ column, operator: 'eq', value });
    return this;
  }

  contains(column, value) {
    this.filters.push({ column, operator: 'contains', value });
    return this;
  }

  maybeSingle() {
    this.singleMode = 'maybe';
    return this;
  }

  single() {
    this.singleMode = 'single';
    return this;
  }

  matches(row) {
    return this.filters.every(({ column, operator, value }) => {
      if (operator === 'eq') return row[column] === value;
      if (operator === 'contains') {
        const actual = row[column];
        return Boolean(actual) && Object.entries(value).every(([key, expected]) => actual[key] === expected);
      }
      return false;
    });
  }

  result(rows) {
    if (this.singleMode === 'maybe') return { data: rows[0] ?? null, error: null };
    if (this.singleMode === 'single') {
      return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } };
    }
    return { data: rows, error: null };
  }

  execute() {
    const rows = this.database[this.table] || [];

    if (this.operation === 'insert') {
      for (const row of this.insertRows) rows.push(row);
      return { data: null, error: null };
    }

    const matches = rows.filter((row) => this.matches(row));

    if (this.operation === 'update') {
      for (const row of matches) Object.assign(row, this.patch);
      return { data: null, error: null };
    }

    return this.result(matches);
  }

  then(resolve, reject) {
    Promise.resolve()
      .then(() => this.execute())
      .then(resolve, reject);
  }
}

function createFakeSupabase() {
  const database = {
    technologies: [{
      node_id: 'TECH_1',
      name: 'Technology One',
      unlock_trl: 4,
    }],
    agency_tech_nodes: [{
      agency_id: 'agency-1',
      node_id: 'TECH_1',
      status: 'RESEARCHING',
      current_trl: 0,
    }],
    logs: [],
  };

  return {
    database,
    supabase: { from: (table) => new FakeQuery(database, table) },
  };
}

const event = {
  id: 'event-1',
  agency_id: 'agency-1',
  reference_id: 'TECH_1',
  execute_at: '2026-11-16T00:00:00.000Z',
  payload: {
    duration_days: 3,
    duration_game_days: 140,
    assigned_engineers: 20,
  },
};

test('TECH_COMPLETE unlocks the node and writes the legacy completion log', async () => {
  const { database, supabase } = createFakeSupabase();

  const result = await handleTechComplete(supabase, event);

  assert.deepEqual(result, {
    node_id: 'TECH_1',
    technology: 'Technology One',
    current_trl: 4,
    completed_at: '2026-11-16T00:00:00.000Z',
    already_unlocked: false,
  });
  assert.equal(database.agency_tech_nodes[0].status, 'UNLOCKED');
  assert.equal(database.agency_tech_nodes[0].current_trl, 4);
  assert.equal(database.logs.length, 1);
  assert.equal(database.logs[0].event_type, 'RESEARCH_COMPLETED');
  assert.equal(database.logs[0].data.event_id, 'event-1');
  assert.equal(database.logs[0].data.technology, 'Technology One');
});

test('TECH_COMPLETE is idempotent when retried', async () => {
  const { database, supabase } = createFakeSupabase();

  await handleTechComplete(supabase, event);
  const second = await handleTechComplete(supabase, event);

  assert.equal(second.already_unlocked, true);
  assert.equal(database.logs.length, 1);
});
