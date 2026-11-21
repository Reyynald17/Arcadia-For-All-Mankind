const AUDIT_ACTOR_TYPES = new Set(['gm', 'player', 'agency', 'system']);
const MAX_LIST_LIMIT = 200;

function migrationMissing(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes('does not exist') ||
    message.includes('Could not find the table')
  );
}

function normalizeActorType(value) {
  return AUDIT_ACTOR_TYPES.has(value) ? value : 'system';
}

function textOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function objectOrNull(value) {
  if (value === undefined || value === null) return null;
  return value;
}

function buildAuditRow(event = {}) {
  return {
    season_id: textOrNull(event.seasonId),
    agency_id: textOrNull(event.agencyId),
    actor_type: normalizeActorType(event.actorType),
    actor_id: textOrNull(event.actorId),
    action: String(event.action || '').trim(),
    entity_type: textOrNull(event.entityType),
    entity_id: textOrNull(event.entityId),
    before_data: objectOrNull(event.beforeData),
    after_data: objectOrNull(event.afterData),
    delta_data: objectOrNull(event.deltaData),
    metadata: objectOrNull(event.metadata),
  };
}

// Best-effort: an unavailable audit table must never break gameplay.
async function recordAuditEvent(supabase, event = {}) {
  const row = buildAuditRow(event);
  if (!row.action) return null;

  try {
    const { error } = await supabase.from('audit_events').insert([row]);
    if (error) {
      if (!migrationMissing(error)) {
        console.error(`audit log: ${error.message}`);
      }
      return null;
    }
    return row;
  } catch (error) {
    console.error(`audit log: ${error.message || error}`);
    return null;
  }
}

async function listAuditEvents(supabase, {
  agencyId,
  actorType,
  action,
  entityType,
  limit = 50,
  before,
} = {}) {
  const parsedLimit = Number(limit);
  const cappedLimit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(Math.floor(parsedLimit), 1), MAX_LIST_LIMIT)
    : 50;

  let query = supabase
    .from('audit_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(cappedLimit);

  if (agencyId) query = query.eq('agency_id', agencyId);
  if (actorType) query = query.eq('actor_type', actorType);
  if (action) query = query.eq('action', action);
  if (entityType) query = query.eq('entity_type', entityType);
  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) {
    if (migrationMissing(error)) {
      const migrationError = new Error('Audit migration is not applied yet');
      migrationError.status = 503;
      migrationError.code = 'AUDIT_MIGRATION_REQUIRED';
      throw migrationError;
    }
    throw new Error(`audit events: ${error.message}`);
  }
  return data || [];
}

function playerActor(req) {
  return {
    actorType: 'player',
    actorId: req?.authUser?.id || null,
  };
}

function gmActor(req) {
  return {
    actorType: 'gm',
    actorId: textOrNull(req?.get?.('x-gm-actor')) || 'gm_key',
  };
}

module.exports = {
  recordAuditEvent,
  listAuditEvents,
  playerActor,
  gmActor,
};
