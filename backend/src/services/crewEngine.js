const { gameDaysToRealMs, loadActiveSeason } = require('./gameClock');
const { recordAuditEvent } = require('./auditLog');

const CREW_ROLES = Object.freeze({
  COMMANDER: {
    key: 'COMMANDER',
    label: 'Commander',
    salary_usd: 150000,
    training_cost_usd: 350000,
  },
  PILOT: {
    key: 'PILOT',
    label: 'Pilot',
    salary_usd: 130000,
    training_cost_usd: 300000,
  },
  MISSION_SPECIALIST: {
    key: 'MISSION_SPECIALIST',
    label: 'Mission Specialist',
    salary_usd: 110000,
    training_cost_usd: 250000,
  },
});

const CREW_ROLE_ORDER = ['COMMANDER', 'PILOT', 'MISSION_SPECIALIST'];
const DEFAULT_ROLE = 'MISSION_SPECIALIST';
const TRAINING_GAME_DAYS = 12;
const PAYROLL_STATUSES = new Set(['ACTIVE', 'TRAINING', 'INJURED']);
const ASSIGNABLE_STATUS = 'ACTIVE';

class CrewError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'CrewError';
    this.status = status;
    this.details = details;
  }
}

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

function normalizeRole(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_ROLE;
  const role = String(value).trim().toUpperCase();
  return CREW_ROLES[role] ? role : null;
}

function normalizeCrewName(value) {
  const name = String(value ?? '').trim();
  if (name.length < 2 || name.length > 40) return null;
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

function calculateCrewPayroll(rows = []) {
  let totalUsd = 0;
  let crewCount = 0;
  const byRole = new Map();

  for (const row of rows || []) {
    const status = String(row?.status || '').toUpperCase();
    if (!PAYROLL_STATUSES.has(status)) continue;

    const role = CREW_ROLES[row?.role] ? row.role : DEFAULT_ROLE;
    const salary = Math.max(0, Number(row?.salary_usd) || 0);
    totalUsd += salary;
    crewCount += 1;

    const line = byRole.get(role) || {
      role,
      label: CREW_ROLES[role].label,
      count: 0,
      total_usd: 0,
    };
    line.count += 1;
    line.total_usd += salary;
    byRole.set(role, line);
  }

  return {
    crew_count: crewCount,
    total_usd: totalUsd,
    by_role: [...byRole.values()].sort(
      (a, b) => CREW_ROLE_ORDER.indexOf(a.role) - CREW_ROLE_ORDER.indexOf(b.role),
    ),
  };
}

async function loadAgencyCrew(supabase, agencyId) {
  try {
    const { data, error } = await supabase
      .from('agency_crew')
      .select('*')
      .eq('agency_id', agencyId)
      .order('hired_at', { ascending: true });

    if (error) throw error;
    return { rows: data || [], migration_required: false };
  } catch (error) {
    if (migrationMissing(error)) {
      return { rows: [], migration_required: true };
    }
    throw new Error(`agency crew: ${error.message}`);
  }
}

function crewCounts(rows = []) {
  const counts = {
    total: rows.length,
    active: 0,
    training: 0,
    injured: 0,
    killed: 0,
    retired: 0,
    assignable: 0,
  };

  for (const row of rows) {
    const status = String(row?.status || '').toUpperCase();
    if (status === 'ACTIVE') counts.active += 1;
    if (status === 'TRAINING') counts.training += 1;
    if (status === 'INJURED') counts.injured += 1;
    if (status === 'KILLED') counts.killed += 1;
    if (status === 'RETIRED') counts.retired += 1;
  }
  counts.assignable = counts.active;
  return counts;
}

async function getCrewOverview(supabase, agencyId, options = {}) {
  const loaded = options.crew
    ? { rows: options.crew, migration_required: false }
    : await loadAgencyCrew(supabase, agencyId);
  const crew = [...(loaded.rows || [])].sort(
    (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
  );

  return {
    migration_required: loaded.migration_required,
    crew,
    counts: crewCounts(crew),
    payroll: calculateCrewPayroll(crew),
    roles: CREW_ROLE_ORDER.map((role) => ({ ...CREW_ROLES[role] })),
    training_game_days: TRAINING_GAME_DAYS,
  };
}

async function recruitCrew(supabase, {
  agency,
  name,
  role,
  actor = null,
  season = null,
  now = new Date(),
} = {}) {
  if (!agency?.id) throw new CrewError(400, 'Agency is required');

  const roleKey = normalizeRole(role);
  if (!roleKey) throw new CrewError(400, `Unknown crew role: ${role}`);
  const crewName = normalizeCrewName(name);
  if (!crewName) throw new CrewError(400, 'Crew name must be between 2 and 40 characters');

  const definition = CREW_ROLES[roleKey];
  const trainingCost = definition.training_cost_usd;
  const fundingBefore = Number(agency.funding_usd || 0);
  if (fundingBefore < trainingCost) {
    throw new CrewError(
      400,
      `Insufficient funding: $${trainingCost.toLocaleString('en-US')} training cost, $${fundingBefore.toLocaleString('en-US')} available`,
    );
  }

  const activeSeason = season || await loadActiveSeason(supabase);
  const multiplier = Number(activeSeason.time_scale_multiplier) || 52.142857;
  const completesAt = new Date(
    now.getTime() + gameDaysToRealMs(TRAINING_GAME_DAYS, multiplier),
  ).toISOString();
  const seasonId = agency.season_id || activeSeason.id;

  let crew = null;
  let scheduled = null;
  let fundingWritten = false;

  try {
    const { data: created, error: insertError } = await supabase
      .from('agency_crew')
      .insert([{
        agency_id: agency.id,
        name: crewName,
        role: roleKey,
        status: 'TRAINING',
        experience: 0,
        missions_flown: 0,
        salary_usd: definition.salary_usd,
        training_cost_usd: trainingCost,
        hired_at: now.toISOString(),
        ready_at: completesAt,
        status_changed_at: now.toISOString(),
      }])
      .select()
      .single();

    if (insertError || !created) {
      if (migrationMissing(insertError)) {
        throw new CrewError(
          503,
          'Personnel migration 015 is not applied yet',
          { code: 'PERSONNEL_MIGRATION_REQUIRED' },
        );
      }
      if (/duplicate|unique/i.test(String(insertError?.message || ''))) {
        throw new CrewError(409, `Crew member ${crewName} already exists`);
      }
      throw new Error(`agency_crew insert: ${insertError?.message || 'insert failed'}`);
    }
    crew = created;

    const newFunding = fundingBefore - trainingCost;
    const { data: updatedAgency, error: fundingError } = await supabase
      .from('agencies')
      .update({ funding_usd: newFunding })
      .eq('id', agency.id)
      .eq('funding_usd', agency.funding_usd)
      .select('id')
      .maybeSingle();

    if (fundingError) throw new Error(`agency funding: ${fundingError.message}`);
    if (!updatedAgency) throw new CrewError(409, 'Agency resources changed; retry the request');
    fundingWritten = true;

    const { data: createdEvent, error: eventError } = await supabase
      .from('scheduled_events')
      .insert([{
        season_id: seasonId,
        agency_id: agency.id,
        event_type: 'CREW_TRAINING_COMPLETE',
        reference_id: crew.id,
        payload: {
          agency_id: agency.id,
          crew_id: crew.id,
          crew_name: crewName,
          role: roleKey,
          training_game_days: TRAINING_GAME_DAYS,
          training_cost_usd: trainingCost,
          completes_at: completesAt,
        },
        execute_at: completesAt,
        status: 'PENDING',
      }])
      .select()
      .single();

    if (eventError || !createdEvent) {
      throw new Error(`crew training event: ${eventError?.message || 'insert failed'}`);
    }
    scheduled = createdEvent;

    const { error: logError } = await supabase
      .from('logs')
      .insert([{
        agency_id: agency.id,
        event_type: 'CREW_RECRUITED',
        description: `Crew recruited: ${crewName} (${definition.label})`,
        data: {
          crew_id: crew.id,
          role: roleKey,
          salary_usd: definition.salary_usd,
          training_cost_usd: trainingCost,
          training_game_days: TRAINING_GAME_DAYS,
          completes_at: completesAt,
        },
      }]);

    if (logError) throw new Error(`crew log: ${logError.message}`);

    await recordAuditEvent(supabase, {
      actorType: actor?.actorType || 'player',
      actorId: actor?.actorId || null,
      seasonId,
      agencyId: agency.id,
      action: 'CREW_RECRUITED',
      entityType: 'agency_crew',
      entityId: crew.id,
      beforeData: { funding_usd: fundingBefore },
      afterData: { funding_usd: newFunding },
      deltaData: { funding_usd: -trainingCost },
      metadata: {
        crew_name: crewName,
        role: roleKey,
        training_game_days: TRAINING_GAME_DAYS,
        completes_at: completesAt,
      },
    });

    return {
      crew,
      role: definition,
      training_cost_usd: trainingCost,
      training_game_days: TRAINING_GAME_DAYS,
      training_completes_at: completesAt,
      new_funding_usd: newFunding,
      event_id: scheduled.id,
    };
  } catch (error) {
    const rollbackErrors = [];

    if (scheduled) {
      const { error: cancelError } = await supabase
        .from('scheduled_events')
        .update({ status: 'CANCELLED', last_error: error.message })
        .eq('id', scheduled.id)
        .eq('status', 'PENDING');
      if (cancelError) rollbackErrors.push(cancelError.message);
    }

    if (fundingWritten) {
      const { error: restoreError } = await supabase
        .from('agencies')
        .update({ funding_usd: fundingBefore })
        .eq('id', agency.id);
      if (restoreError) rollbackErrors.push(restoreError.message);
    }

    if (crew) {
      const { error: deleteError } = await supabase
        .from('agency_crew')
        .delete()
        .eq('id', crew.id);
      if (deleteError) rollbackErrors.push(deleteError.message);
    }

    if (rollbackErrors.length > 0) {
      console.error('Crew recruitment rollback failed:', rollbackErrors.join('; '));
    }

    throw error;
  }
}

async function handleCrewTrainingComplete(supabase, event, options = {}) {
  const crewId = event?.reference_id || event?.payload?.crew_id;
  if (!crewId) throw new Error('CREW_TRAINING_COMPLETE requires a crew reference');

  const { data: crew, error } = await supabase
    .from('agency_crew')
    .select('*')
    .eq('id', crewId)
    .maybeSingle();

  if (error) throw new Error(`CREW_TRAINING_COMPLETE crew: ${error.message}`);
  if (!crew) return { crew_id: crewId, status: 'skipped', reason: 'CREW_NOT_FOUND' };

  if (String(crew.status || '').toUpperCase() !== 'TRAINING') {
    return {
      crew_id: crewId,
      status: crew.status,
      already_completed: true,
    };
  }

  const eventDate = event?.execute_at ? new Date(event.execute_at) : null;
  const completedAt = eventDate && Number.isFinite(eventDate.getTime())
    ? eventDate.toISOString()
    : (options.now || new Date()).toISOString();

  const { data: updated, error: updateError } = await supabase
    .from('agency_crew')
    .update({
      status: 'ACTIVE',
      ready_at: completedAt,
      status_changed_at: completedAt,
    })
    .eq('id', crewId)
    .eq('status', 'TRAINING')
    .select('id')
    .maybeSingle();

  if (updateError) throw new Error(`CREW_TRAINING_COMPLETE update: ${updateError.message}`);
  if (!updated) {
    return { crew_id: crewId, status: 'ACTIVE', already_completed: true };
  }

  const { error: logError } = await supabase
    .from('logs')
    .insert([{
      agency_id: crew.agency_id,
      event_type: 'CREW_READY',
      description: `Crew ready for assignment: ${crew.name}`,
      data: {
        event_id: event?.id || null,
        crew_id: crew.id,
        crew_name: crew.name,
        role: crew.role,
        ready_at: completedAt,
      },
    }]);

  if (logError) {
    console.error(`crew ready log: ${logError.message}`);
  }

  await recordAuditEvent(supabase, {
    actorType: 'system',
    actorId: 'crew_engine',
    seasonId: event?.season_id || null,
    agencyId: crew.agency_id,
    action: 'CREW_ACTIVATED',
    entityType: 'agency_crew',
    entityId: crew.id,
    beforeData: { status: 'TRAINING' },
    afterData: { status: 'ACTIVE' },
    metadata: { crew_name: crew.name, role: crew.role, ready_at: completedAt },
  });

  return {
    crew_id: crewId,
    status: 'ACTIVE',
    ready_at: completedAt,
    already_completed: false,
  };
}

function selectMissionCrew(rows = [], required = 0) {
  const count = Math.max(0, Math.floor(Number(required) || 0));
  if (count === 0) return [];

  return (rows || [])
    .filter((row) => String(row?.status || '').toUpperCase() === ASSIGNABLE_STATUS)
    .sort((a, b) => {
      const roleDelta =
        CREW_ROLE_ORDER.indexOf(a.role) - CREW_ROLE_ORDER.indexOf(b.role);
      if (roleDelta !== 0) return roleDelta;
      const experienceDelta = Number(b.experience || 0) - Number(a.experience || 0);
      if (experienceDelta !== 0) return experienceDelta;
      const flightsDelta =
        Number(b.missions_flown || 0) - Number(a.missions_flown || 0);
      if (flightsDelta !== 0) return flightsDelta;
      return String(a.name || '').localeCompare(String(b.name || ''));
    })
    .slice(0, count);
}

async function loadMissionCrewContext(supabase, missionId) {
  try {
    const { data: assignments, error } = await supabase
      .from('mission_crew')
      .select('*')
      .eq('mission_id', missionId);

    if (error) throw error;
    const rows = assignments || [];
    if (rows.length === 0) {
      return {
        assignments: [],
        crew: [],
        crew_experience: 0,
        migration_required: false,
      };
    }

    const crewIds = rows.map((row) => row.crew_id);
    const { data: crewRows, error: crewError } = await supabase
      .from('agency_crew')
      .select('*')
      .in('id', crewIds);

    if (crewError) throw crewError;
    const crew = crewRows || [];
    const experience = crew.length
      ? crew.reduce((sum, row) => sum + Number(row.experience || 0), 0) / crew.length
      : 0;

    return {
      assignments: rows,
      crew,
      crew_experience: experience,
      migration_required: false,
    };
  } catch (error) {
    if (migrationMissing(error)) {
      return {
        assignments: [],
        crew: [],
        crew_experience: 0,
        migration_required: true,
      };
    }
    throw new Error(`mission crew context: ${error.message}`);
  }
}

async function resolveMissionCrew(supabase, missionId, {
  success = false,
  crewDeaths = 0,
  now = new Date(),
} = {}) {
  let assignments = [];
  try {
    const { data, error } = await supabase
      .from('mission_crew')
      .select('*')
      .eq('mission_id', missionId);
    if (error) throw error;
    assignments = data || [];
  } catch (error) {
    if (migrationMissing(error)) return { skipped: true, reason: 'MIGRATION_REQUIRED' };
    throw new Error(`mission crew resolve: ${error.message}`);
  }

  if (assignments.length === 0) {
    return { assignments: 0, survived: 0, killed: 0 };
  }

  const crewIds = assignments.map((row) => row.crew_id);
  const { data: crewRows, error: crewError } = await supabase
    .from('agency_crew')
    .select('*')
    .in('id', crewIds);
  if (crewError) throw new Error(`mission crew rows: ${crewError.message}`);
  const crewById = new Map((crewRows || []).map((row) => [row.id, row]));

  const ordered = [...assignments].sort((a, b) => {
    const roleDelta = CREW_ROLE_ORDER.indexOf(a.role) - CREW_ROLE_ORDER.indexOf(b.role);
    if (roleDelta !== 0) return roleDelta;
    return String(a.crew_id).localeCompare(String(b.crew_id));
  });
  const deathCount = Math.max(0, Math.min(ordered.length, Math.floor(Number(crewDeaths) || 0)));
  const killedIds = new Set(ordered.slice(0, deathCount).map((row) => row.crew_id));
  const resolvedAt = (now instanceof Date ? now : new Date(now)).toISOString();

  for (const assignment of ordered) {
    const crew = crewById.get(assignment.crew_id) || null;
    const killed = killedIds.has(assignment.crew_id);
    const patch = {
      missions_flown: Number(crew?.missions_flown || 0) + 1,
    };

    if (killed) {
      patch.status = 'KILLED';
      patch.status_changed_at = resolvedAt;
    } else if (success) {
      patch.experience = Number(crew?.experience || 0) + 1;
    }

    const { error: crewUpdateError } = await supabase
      .from('agency_crew')
      .update(patch)
      .eq('id', assignment.crew_id);
    if (crewUpdateError) {
      throw new Error(`agency_crew resolve: ${crewUpdateError.message}`);
    }
  }

  if (killedIds.size > 0) {
    const { error: killedError } = await supabase
      .from('mission_crew')
      .update({ outcome: 'KILLED' })
      .eq('mission_id', missionId)
      .in('crew_id', [...killedIds]);
    if (killedError) throw new Error(`mission_crew killed: ${killedError.message}`);
  }

  const survivorIds = ordered
    .map((row) => row.crew_id)
    .filter((crewId) => !killedIds.has(crewId));
  if (survivorIds.length > 0) {
    const { error: survivorError } = await supabase
      .from('mission_crew')
      .update({ outcome: 'SURVIVED' })
      .eq('mission_id', missionId)
      .in('crew_id', survivorIds);
    if (survivorError) throw new Error(`mission_crew survivors: ${survivorError.message}`);
  }

  const casualtyLogs = ordered
    .filter((assignment) => killedIds.has(assignment.crew_id))
    .map((assignment) => {
      const crew = crewById.get(assignment.crew_id) || null;
      return {
        agency_id: crew?.agency_id || null,
        event_type: 'CREW_KILLED',
        description: `Crew lost: ${crew?.name || assignment.crew_id} (${assignment.role}) on mission ${missionId}`,
        data: {
          mission_id: missionId,
          crew_id: assignment.crew_id,
          crew_name: crew?.name || null,
          role: assignment.role,
        },
      };
    });

  if (casualtyLogs.length > 0) {
    const { error: casualtyError } = await supabase.from('logs').insert(casualtyLogs);
    if (casualtyError) {
      console.error(`crew casualty log: ${casualtyError.message}`);
    }
  }

  await recordAuditEvent(supabase, {
    actorType: 'system',
    actorId: 'crew_engine',
    agencyId: crewById.get(ordered[0]?.crew_id)?.agency_id || null,
    action: 'MISSION_CREW_RESOLVED',
    entityType: 'mission',
    entityId: missionId,
    afterData: {
      survived: survivorIds.length,
      killed: killedIds.size,
    },
    metadata: {
      success,
      crew_deaths: killedIds.size,
      crew_ids: ordered.map((row) => row.crew_id),
    },
  });

  return {
    assignments: ordered.length,
    survived: survivorIds.length,
    killed: killedIds.size,
  };
}

module.exports = {
  CREW_ROLES,
  CREW_ROLE_ORDER,
  DEFAULT_ROLE,
  TRAINING_GAME_DAYS,
  CrewError,
  migrationMissing,
  normalizeRole,
  calculateCrewPayroll,
  loadAgencyCrew,
  getCrewOverview,
  recruitCrew,
  handleCrewTrainingComplete,
  selectMissionCrew,
  loadMissionCrewContext,
  resolveMissionCrew,
};
