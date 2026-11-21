const { gameDaysToRealMs, loadActiveSeason } = require('./gameClock');
const { hashSeed, createSeededRng } = require('./seededRng');
const { recordAuditEvent } = require('./auditLog');

const INVESTIGATION_GAME_DAYS = 5;
const MAX_RELIABILITY = 95;
const MIN_RELIABILITY_GAIN = 2;
const MAX_RELIABILITY_GAIN = 6;

const INVESTIGATION_COST_USD = Object.freeze({
  test: 100000,
  scientific: 200000,
  manned: 350000,
  colonial: 600000,
});
const DEFAULT_INVESTIGATION_COST_USD = 150000;

const INVESTIGATION_STAGES = Object.freeze([
  'LAUNCH',
  'ORBIT_INSERTION',
  'ORBIT_OPERATIONS',
]);

const STAGE_CAUSES = Object.freeze({
  LAUNCH: [
    'TURBOPUMP_CAVITATION',
    'STRUCTURAL_LOAD_EXCEEDANCE',
    'GUIDANCE_DRIFT',
    'WEATHER_VIOLATION',
  ],
  ORBIT_INSERTION: [
    'UPPER_STAGE_IGNITION_FAILURE',
    'AVIONICS_RESET',
    'PROPELLANT_VENTING',
    'TELEMETRY_LOSS',
  ],
  ORBIT_OPERATIONS: [
    'POWER_BUS_FAULT',
    'THERMAL_CONTROL_FAILURE',
    'CREW_SYSTEM_FAILURE',
    'COMMUNICATIONS_LOSS',
  ],
});

class InvestigationError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'InvestigationError';
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

function investigationCost(missionType) {
  return INVESTIGATION_COST_USD[missionType] ?? DEFAULT_INVESTIGATION_COST_USD;
}

function humanizeCause(cause) {
  return String(cause || 'unclassified failure')
    .toLowerCase()
    .split('_')
    .join(' ');
}

function eventTime(event) {
  const date = event?.execute_at ? new Date(event.execute_at) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

async function listInvestigations(supabase, agencyId, { limit = 8 } = {}) {
  try {
    const { data, error } = await supabase
      .from('mission_investigations')
      .select('*')
      .eq('agency_id', agencyId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return { items: data || [], migration_required: false };
  } catch (error) {
    if (migrationMissing(error)) {
      return { items: [], migration_required: true };
    }
    throw new Error(`mission investigations: ${error.message}`);
  }
}

// Best-effort: a failed investigation insert must never retry a resolved launch.
async function createInvestigationIfMissing(supabase, {
  mission,
  stage,
  now = new Date(),
} = {}) {
  if (!mission?.id || !mission?.agency_id || !stage) return null;

  try {
    const { data, error } = await supabase
      .from('mission_investigations')
      .upsert([{
        agency_id: mission.agency_id,
        mission_id: mission.id,
        season_id: mission.season_id || null,
        mission_name: mission.name || null,
        stage,
        status: 'OPEN',
        cost_usd: investigationCost(mission.type),
        created_at: (now instanceof Date ? now : new Date(now)).toISOString(),
      }], { onConflict: 'mission_id', ignoreDuplicates: true })
      .select()
      .maybeSingle();

    if (error) {
      if (!migrationMissing(error) && !/duplicate|unique/i.test(String(error.message || ''))) {
        console.error(`investigation create: ${error.message}`);
      }
      return null;
    }
    return data || null;
  } catch (error) {
    if (!migrationMissing(error)) {
      console.error(`investigation create: ${error.message || error}`);
    }
    return null;
  }
}

async function startInvestigation(supabase, {
  agency,
  missionId,
  actor = null,
  season = null,
  now = new Date(),
} = {}) {
  if (!agency?.id) throw new InvestigationError(400, 'Agency is required');
  if (!missionId) throw new InvestigationError(400, 'missionId is required');

  let investigation = null;
  try {
    const { data, error } = await supabase
      .from('mission_investigations')
      .select('*')
      .eq('mission_id', missionId)
      .eq('agency_id', agency.id)
      .maybeSingle();

    if (error) throw error;
    investigation = data;
  } catch (error) {
    if (migrationMissing(error)) {
      throw new InvestigationError(
        503,
        'Personnel migration 015 is not applied yet',
        { code: 'PERSONNEL_MIGRATION_REQUIRED' },
      );
    }
    throw new Error(`investigation lookup: ${error.message}`);
  }

  if (!investigation) {
    throw new InvestigationError(404, 'No failure investigation recorded for this mission');
  }
  if (investigation.status === 'COMPLETED') {
    throw new InvestigationError(409, 'Investigation already completed');
  }
  if (investigation.status === 'IN_PROGRESS') {
    throw new InvestigationError(409, 'Investigation already in progress');
  }

  const cost = Number(investigation.cost_usd || 0);
  const fundingBefore = Number(agency.funding_usd || 0);
  if (fundingBefore < cost) {
    throw new InvestigationError(
      400,
      `Insufficient funding: $${cost.toLocaleString('en-US')} investigation cost, $${fundingBefore.toLocaleString('en-US')} available`,
    );
  }

  const activeSeason = season || await loadActiveSeason(supabase);
  const multiplier = Number(activeSeason.time_scale_multiplier) || 52.142857;
  const startedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const completesAt = new Date(
    new Date(startedAt).getTime() + gameDaysToRealMs(INVESTIGATION_GAME_DAYS, multiplier),
  ).toISOString();
  const seasonId = agency.season_id || activeSeason.id;

  let claimed = null;
  let scheduled = null;
  let fundingWritten = false;

  try {
    const { data: updatedRow, error: claimError } = await supabase
      .from('mission_investigations')
      .update({
        status: 'IN_PROGRESS',
        started_at: startedAt,
        completes_at: completesAt,
      })
      .eq('id', investigation.id)
      .eq('status', 'OPEN')
      .select()
      .maybeSingle();

    if (claimError) throw new Error(`investigation claim: ${claimError.message}`);
    if (!updatedRow) {
      throw new InvestigationError(409, 'Investigation already started');
    }
    claimed = updatedRow;

    const newFunding = fundingBefore - cost;
    const { data: updatedAgency, error: fundingError } = await supabase
      .from('agencies')
      .update({ funding_usd: newFunding })
      .eq('id', agency.id)
      .eq('funding_usd', agency.funding_usd)
      .select('id')
      .maybeSingle();

    if (fundingError) throw new Error(`investigation funding: ${fundingError.message}`);
    if (!updatedAgency) {
      throw new InvestigationError(409, 'Agency resources changed; retry the request');
    }
    fundingWritten = true;

    const { data: createdEvent, error: eventError } = await supabase
      .from('scheduled_events')
      .insert([{
        season_id: seasonId,
        agency_id: agency.id,
        event_type: 'INVESTIGATION_COMPLETE',
        reference_id: investigation.id,
        payload: {
          agency_id: agency.id,
          mission_id: missionId,
          investigation_id: investigation.id,
          investigation_stage: investigation.stage,
          investigation_game_days: INVESTIGATION_GAME_DAYS,
          cost_usd: cost,
          completes_at: completesAt,
        },
        execute_at: completesAt,
        status: 'PENDING',
      }])
      .select()
      .single();

    if (eventError || !createdEvent) {
      throw new Error(`investigation event: ${eventError?.message || 'insert failed'}`);
    }
    scheduled = createdEvent;

    const { error: logError } = await supabase
      .from('logs')
      .insert([{
        agency_id: agency.id,
        event_type: 'INVESTIGATION_STARTED',
        description: `Investigation opened: ${investigation.mission_name || missionId}`,
        data: {
          investigation_id: investigation.id,
          mission_id: missionId,
          stage: investigation.stage,
          cost_usd: cost,
          investigation_game_days: INVESTIGATION_GAME_DAYS,
          completes_at: completesAt,
        },
      }]);

    if (logError) {
      console.error(`investigation started log: ${logError.message}`);
    }

    await recordAuditEvent(supabase, {
      actorType: actor?.actorType || 'player',
      actorId: actor?.actorId || null,
      seasonId,
      agencyId: agency.id,
      action: 'INVESTIGATION_STARTED',
      entityType: 'mission_investigation',
      entityId: investigation.id,
      beforeData: { funding_usd: fundingBefore, status: 'OPEN' },
      afterData: { funding_usd: newFunding, status: 'IN_PROGRESS' },
      deltaData: { funding_usd: -cost },
      metadata: {
        mission_id: missionId,
        mission_name: investigation.mission_name,
        stage: investigation.stage,
        completes_at: completesAt,
      },
    });

    return {
      investigation: claimed,
      mission_id: missionId,
      cost_usd: cost,
      new_funding_usd: newFunding,
      investigation_game_days: INVESTIGATION_GAME_DAYS,
      completes_at: completesAt,
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

    if (claimed) {
      const { error: revertError } = await supabase
        .from('mission_investigations')
        .update({ status: 'OPEN', started_at: null, completes_at: null })
        .eq('id', claimed.id)
        .eq('status', 'IN_PROGRESS');
      if (revertError) rollbackErrors.push(revertError.message);
    }

    if (rollbackErrors.length > 0) {
      console.error('Investigation start rollback failed:', rollbackErrors.join('; '));
    }

    throw error;
  }
}

async function handleInvestigationComplete(supabase, event) {
  const investigationId = event?.reference_id || event?.payload?.investigation_id;
  if (!investigationId) throw new Error('INVESTIGATION_COMPLETE requires an investigation reference');

  const { data: investigation, error } = await supabase
    .from('mission_investigations')
    .select('*')
    .eq('id', investigationId)
    .maybeSingle();

  if (error) throw new Error(`INVESTIGATION_COMPLETE lookup: ${error.message}`);
  if (!investigation) {
    return { investigation_id: investigationId, status: 'skipped', reason: 'NOT_FOUND' };
  }
  if (investigation.status === 'COMPLETED') {
    return {
      investigation_id: investigationId,
      status: 'COMPLETED',
      already_completed: true,
    };
  }
  if (investigation.status !== 'IN_PROGRESS') {
    return {
      investigation_id: investigationId,
      status: investigation.status,
      skipped: true,
      reason: 'NOT_STARTED',
    };
  }

  const rng = createSeededRng(hashSeed(`${investigation.id}:investigation`));
  const causes = STAGE_CAUSES[investigation.stage] || STAGE_CAUSES.LAUNCH;
  const cause = causes[Math.floor(rng() * causes.length) % causes.length];
  const reliabilityBonus =
    MIN_RELIABILITY_GAIN
    + Math.floor(rng() * (MAX_RELIABILITY_GAIN - MIN_RELIABILITY_GAIN + 1));
  const completedAt = eventTime(event);

  let reliabilityBefore = null;
  let reliabilityAfter = null;
  let vehicleId = null;

  const { data: mission, error: missionError } = await supabase
    .from('missions')
    .select('*')
    .eq('id', investigation.mission_id)
    .maybeSingle();
  if (missionError) throw new Error(`INVESTIGATION_COMPLETE mission: ${missionError.message}`);

  if (mission?.vehicle_id) {
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', mission.vehicle_id)
      .maybeSingle();
    if (vehicleError) throw new Error(`INVESTIGATION_COMPLETE vehicle: ${vehicleError.message}`);

    if (vehicle) {
      vehicleId = vehicle.id;
      reliabilityBefore = Number(vehicle.reliability || 0);
      reliabilityAfter = Math.min(MAX_RELIABILITY, reliabilityBefore + reliabilityBonus);

      if (reliabilityAfter > reliabilityBefore) {
        const { error: updateVehicleError } = await supabase
          .from('vehicles')
          .update({ reliability: reliabilityAfter })
          .eq('id', vehicle.id);
        if (updateVehicleError) {
          throw new Error(`INVESTIGATION_COMPLETE vehicle update: ${updateVehicleError.message}`);
        }
      }
    }
  }

  const findings = `Root cause traced to ${humanizeCause(cause)}. Corrective action restored ${reliabilityBonus} reliability points.`;

  const { data: completed, error: updateError } = await supabase
    .from('mission_investigations')
    .update({
      status: 'COMPLETED',
      cause,
      findings,
      reliability_bonus: reliabilityBonus,
      completed_at: completedAt,
    })
    .eq('id', investigation.id)
    .eq('status', 'IN_PROGRESS')
    .select()
    .maybeSingle();

  if (updateError) throw new Error(`INVESTIGATION_COMPLETE update: ${updateError.message}`);
  if (!completed) {
    return {
      investigation_id: investigationId,
      status: 'COMPLETED',
      already_completed: true,
    };
  }

  const { error: logError } = await supabase
    .from('logs')
    .insert([{
      agency_id: investigation.agency_id,
      event_type: 'INVESTIGATION_COMPLETED',
      description: `Investigation completed: ${investigation.mission_name || investigation.mission_id} // ${humanizeCause(cause)}`,
      data: {
        event_id: event?.id || null,
        investigation_id: investigation.id,
        mission_id: investigation.mission_id,
        stage: investigation.stage,
        cause,
        findings,
        reliability_bonus: reliabilityBonus,
        vehicle_id: vehicleId,
        vehicle_reliability_before: reliabilityBefore,
        vehicle_reliability_after: reliabilityAfter,
        completed_at: completedAt,
      },
    }]);

  if (logError) {
    console.error(`investigation completed log: ${logError.message}`);
  }

  await recordAuditEvent(supabase, {
    actorType: 'system',
    actorId: 'investigation_engine',
    seasonId: event?.season_id || null,
    agencyId: investigation.agency_id,
    action: 'INVESTIGATION_COMPLETED',
    entityType: 'mission_investigation',
    entityId: investigation.id,
    beforeData: { status: 'IN_PROGRESS', vehicle_reliability: reliabilityBefore },
    afterData: { status: 'COMPLETED', vehicle_reliability: reliabilityAfter },
    deltaData: reliabilityBefore === null || reliabilityAfter === null
      ? null
      : { vehicle_reliability: reliabilityAfter - reliabilityBefore },
    metadata: {
      mission_id: investigation.mission_id,
      mission_name: investigation.mission_name,
      stage: investigation.stage,
      cause,
      findings,
      reliability_bonus: reliabilityBonus,
      vehicle_id: vehicleId,
    },
  });

  return {
    investigation_id: investigation.id,
    status: 'COMPLETED',
    already_completed: false,
    cause,
    findings,
    reliability_bonus: reliabilityBonus,
    vehicle_id: vehicleId,
    vehicle_reliability_before: reliabilityBefore,
    vehicle_reliability_after: reliabilityAfter,
    completed_at: completedAt,
  };
}

module.exports = {
  INVESTIGATION_GAME_DAYS,
  INVESTIGATION_COST_USD,
  DEFAULT_INVESTIGATION_COST_USD,
  INVESTIGATION_STAGES,
  STAGE_CAUSES,
  InvestigationError,
  investigationCost,
  migrationMissing,
  listInvestigations,
  createInvestigationIfMissing,
  startInvestigation,
  handleInvestigationComplete,
};
