const test = require('node:test');
const assert = require('node:assert/strict');
const { createEventQueue, retryDelayMs } = require('../src/services/eventQueue');

class FakeQuery {
  constructor(store) {
    this.store = store;
    this.operation = null;
    this.patch = null;
    this.filters = [];
    this.returnRows = false;
    this.singleMode = null;
    this.orderBy = null;
    this.limitValue = null;
  }

  select() {
    if (this.operation === 'update') this.returnRows = true;
    else this.operation = 'select';
    return this;
  }

  update(patch) {
    this.operation = 'update';
    this.patch = patch;
    return this;
  }

  eq(column, value) {
    this.filters.push({ column, operator: 'eq', value });
    return this;
  }

  lte(column, value) {
    this.filters.push({ column, operator: 'lte', value });
    return this;
  }

  lt(column, value) {
    this.filters.push({ column, operator: 'lt', value });
    return this;
  }

  order(column) {
    this.orderBy = column;
    return this;
  }

  limit(value) {
    this.limitValue = value;
    return this;
  }

  maybeSingle() {
    this.singleMode = 'maybe';
    return this;
  }

  matches(row) {
    return this.filters.every(({ column, operator, value }) => {
      if (operator === 'eq') return row[column] === value;
      if (operator === 'lte') return row[column] <= value;
      if (operator === 'lt') return row[column] < value;
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
    const matches = this.store.rows.filter((row) => this.matches(row));

    if (this.operation === 'update') {
      for (const row of matches) Object.assign(row, this.patch);
      return this.result(this.returnRows ? matches : []);
    }

    let rows = matches;
    if (this.orderBy) {
      rows = [...rows].sort((left, right) =>
        String(left[this.orderBy]).localeCompare(String(right[this.orderBy])));
    }
    if (this.limitValue) rows = rows.slice(0, this.limitValue);
    return this.result(rows);
  }

  then(resolve, reject) {
    Promise.resolve()
      .then(() => this.execute())
      .then(resolve, reject);
  }
}

function createFakeSupabase(rows) {
  const store = { rows };
  return { from: () => new FakeQuery(store) };
}

function createSilentLogger() {
  return { error() {} };
}

test('processes a due event and records its result', async () => {
  const rows = [{
    id: 'event-1',
    event_type: 'TECH_COMPLETE',
    status: 'PENDING',
    execute_at: '2020-01-01T00:00:00.000Z',
    attempts: 0,
    locked_at: null,
    payload: {},
    reference_id: 'TECH_1',
  }];
  const handled = [];
  const queue = createEventQueue({
    supabase: createFakeSupabase(rows),
    handlers: {
      TECH_COMPLETE: async (event) => {
        handled.push(event.id);
        return { unlocked: true };
      },
    },
    logger: createSilentLogger(),
  });

  const result = await queue.processDueEvents();

  assert.deepEqual(result, { processed: 1, failed: 0, skipped: 0 });
  assert.deepEqual(handled, ['event-1']);
  assert.equal(rows[0].status, 'PROCESSED');
  assert.equal(rows[0].attempts, 1);
  assert.ok(rows[0].processed_at);
  assert.deepEqual(rows[0].result_log, { unlocked: true });
});

test('retries failures and marks the event failed at the attempt limit', async () => {
  const rows = [{
    id: 'event-2',
    event_type: 'TECH_COMPLETE',
    status: 'PENDING',
    execute_at: '2020-01-01T00:00:00.000Z',
    attempts: 0,
    locked_at: null,
    payload: {},
    reference_id: 'TECH_2',
  }];
  const queue = createEventQueue({
    supabase: createFakeSupabase(rows),
    handlers: {
      TECH_COMPLETE: async () => {
        throw new Error('handler failed');
      },
    },
    maxAttempts: 2,
    logger: createSilentLogger(),
  });

  const first = await queue.processDueEvents();
  assert.deepEqual(first, { processed: 0, failed: 1, skipped: 0 });
  assert.equal(rows[0].status, 'PENDING');
  assert.equal(rows[0].attempts, 1);
  assert.equal(rows[0].last_error, 'handler failed');
  assert.ok(new Date(rows[0].execute_at).getTime() > Date.now());

  rows[0].execute_at = '2020-01-01T00:00:00.000Z';
  const second = await queue.processDueEvents();

  assert.deepEqual(second, { processed: 0, failed: 1, skipped: 0 });
  assert.equal(rows[0].status, 'FAILED');
  assert.equal(rows[0].attempts, 2);
});

test('retry delays grow and are capped', () => {
  assert.equal(retryDelayMs(1), 30000);
  assert.equal(retryDelayMs(2), 60000);
  assert.equal(retryDelayMs(20), 900000);
});
