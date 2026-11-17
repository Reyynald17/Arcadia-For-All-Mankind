class FakeQuery {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.operation = null;
    this.patch = null;
    this.insertRows = null;
    this.filters = [];
    this.singleMode = null;
    this.returnRows = false;
    this.rowLimit = null;
  }

  select() {
    if (!['insert', 'update', 'delete', 'upsert'].includes(this.operation)) {
      this.operation = 'select';
    }
    this.returnRows = true;
    return this;
  }

  insert(rows) {
    this.operation = 'insert';
    this.insertRows = rows;
    return this;
  }

  upsert(rows, options = {}) {
    this.operation = 'upsert';
    this.insertRows = rows;
    this.onConflict = options.onConflict || 'id';
    return this;
  }

  update(patch) {
    this.operation = 'update';
    this.patch = patch;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  eq(column, value) {
    this.filters.push({ column, operator: 'eq', value });
    return this;
  }

  in(column, values) {
    this.filters.push({ column, operator: 'in', value: values });
    return this;
  }

  contains(column, value) {
    this.filters.push({ column, operator: 'contains', value });
    return this;
  }

  like(column, pattern) {
    this.filters.push({ column, operator: 'like', value: pattern });
    return this;
  }

  limit(value) {
    this.rowLimit = value;
    return this;
  }

  order() {
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
      if (operator === 'in') return value.includes(row[column]);
      if (operator === 'contains') {
        const actual = row[column];
        return Boolean(actual)
          && Object.entries(value).every(([key, expected]) => actual[key] === expected);
      }
      if (operator === 'like') {
        const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`);
        return regex.test(String(row[column] ?? ''));
      }
      return false;
    });
  }

  result(rows) {
    const limited = this.rowLimit === null ? rows : rows.slice(0, this.rowLimit);
    if (this.singleMode === 'maybe') {
      return { data: limited[0] ? structuredClone(limited[0]) : null, error: null };
    }
    if (this.singleMode === 'single') {
      return limited[0]
        ? { data: structuredClone(limited[0]), error: null }
        : { data: null, error: { message: 'not found' } };
    }
    return { data: structuredClone(limited), error: null };
  }

  execute() {
    const rows = this.database[this.table] || (this.database[this.table] = []);

    if (this.operation === 'insert') {
      const inserted = this.insertRows.map((row) => ({
        id: row.id || `row-${rows.length + 1}-${Date.now()}`,
        ...row,
      }));
      rows.push(...inserted);
      return this.returnRows ? this.result(inserted) : { data: null, error: null };
    }

    if (this.operation === 'upsert') {
      const columns = String(this.onConflict).split(',').map((column) => column.trim());
      const upserted = this.insertRows.map((row) => {
        const existing = rows.find((candidate) =>
          columns.every((column) => candidate[column] === row[column]),
        );
        if (existing) {
          Object.assign(existing, row);
          return existing;
        }
        const inserted = { id: row.id || `row-${rows.length + 1}-${Date.now()}`, ...row };
        rows.push(inserted);
        return inserted;
      });
      return this.returnRows ? this.result(upserted) : { data: null, error: null };
    }

    const matches = rows.filter((row) => this.matches(row));

    if (this.operation === 'update') {
      for (const row of matches) Object.assign(row, this.patch);
      return this.returnRows ? this.result(matches) : { data: null, error: null };
    }

    if (this.operation === 'delete') {
      this.database[this.table] = rows.filter((row) => !this.matches(row));
      return this.returnRows ? this.result(matches) : { data: null, error: null };
    }

    return this.result(matches);
  }

  then(resolve, reject) {
    Promise.resolve()
      .then(() => this.execute())
      .then(resolve, reject);
  }
}

function createFakeSupabase(database, options = {}) {
  return {
    database,
    client: {
      from: (table) => new FakeQuery(database, table),
      rpc: async (name, params) => {
        const handler = options.rpc?.[name];
        if (typeof handler !== 'function') {
          return { data: null, error: { message: `rpc ${name} is not configured` } };
        }
        try {
          const result = await handler(params, database);
          return { data: result ?? null, error: null };
        } catch (error) {
          return { data: null, error: { message: error?.message || String(error) } };
        }
      },
      auth: {
        getUser: async () => {
          if (options.authError) {
            return { data: { user: null }, error: options.authError };
          }
          return {
            data: { user: { id: options.userId || 'user-1' } },
            error: null,
          };
        },
      },
    },
  };
}

module.exports = { FakeQuery, createFakeSupabase };
