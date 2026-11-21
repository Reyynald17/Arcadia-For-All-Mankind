const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase } = require('../test-support/fakeSupabase');
const { recordAuditEvent, listAuditEvents } = require('../src/services/auditLog');

test('recordAuditEvent stores normalized audit rows', async () => {
  const { database, client } = createFakeSupabase({ audit_events: [] });

  const row = await recordAuditEvent(client, {
    actorType: 'gm',
    actorId: 'gm_key',
    agencyId: 'agency-1',
    action: 'GM_UPDATE_STATS',
    entityType: 'agency',
    entityId: 'agency-1',
    beforeData: { funding_usd: 100 },
    afterData: { funding_usd: 150 },
    deltaData: { funding_usd: 50 },
    metadata: { reason: 'test' },
  });

  assert.equal(row.actor_type, 'gm');
  assert.equal(database.audit_events.length, 1);
  assert.deepEqual(database.audit_events[0].delta_data, { funding_usd: 50 });
});

test('recordAuditEvent never throws when the audit table is unavailable', async () => {
  const client = {
    from: () => ({
      insert: async () => ({ error: { code: '42P01', message: 'relation does not exist' } }),
    }),
  };

  const row = await recordAuditEvent(client, { action: 'GM_ADVANCE_TIME' });
  assert.equal(row, null);
});

test('listAuditEvents filters by agency and caps the limit', async () => {
  const { database, client } = createFakeSupabase({ audit_events: [] });
  database.audit_events.push(
    { id: 'a1', agency_id: 'agency-1', action: 'GM_UPDATE_STATS', created_at: '2026-11-21T00:00:00Z' },
    { id: 'a2', agency_id: 'agency-2', action: 'GM_UPDATE_STATS', created_at: '2026-11-21T00:01:00Z' },
  );

  const events = await listAuditEvents(client, { agencyId: 'agency-1', limit: 999 });
  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'a1');
});

test('listAuditEvents reports a missing migration', async () => {
  const client = {
    from: () => {
      const query = {
        select: () => query,
        order: () => query,
        limit: () => query,
        eq: () => query,
        then: (resolve) => resolve({
          data: null,
          error: { code: 'PGRST205', message: 'Could not find the table audit_events' },
        }),
      };
      return query;
    },
  };

  await assert.rejects(
    () => listAuditEvents(client, {}),
    (error) => error.status === 503 && error.code === 'AUDIT_MIGRATION_REQUIRED',
  );
});
