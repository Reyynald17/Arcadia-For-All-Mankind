const AGMEngine = require('./agm');
const { gameDaysToRealMs } = require('./gameClock');
const { hashSeed, createSeededRng } = require('./seededRng');
const {
  planOrbit,
  orbitOperationsGameDays,
} = require('./orbitalEngine');

const ROLLOUT_MIN_GAME_DAYS = 45;
const ROLLOUT_MAX_GAME_DAYS = 60;
const COUNTDOWN_GAME_DAYS = 1;
const ACTIVE_MISSION_STATUSES = ['PLANNED', 'ROLLOUT', 'COUNTDOWN', 'ASCENT'];
const RESOLVED_MISSION_STATUSES = new Set(['ORBIT', 'COMPLETED', 'FAILED', 'ABORTED']);
const TERMINAL_MISSION_STATUSES = new Set(['COMPLETED', 'FAILED', 'ABORTED']);

function eventTime(event) {
  const date = event?.execute_at ? new Date(event.execute_at) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function planLaunchSchedule({ missionSeed, multiplier, now = new Date() }) {
  const rng = createSeededRng(`rollout:${missionSeed}`);
  const rolloutGameDays = Math.round(
    ROLLOUT_MIN_GAME_DAYS + rng() * (ROLLOUT_MAX_GAME_DAYS - ROLLOUT_MIN_GAME_DAYS),
  );
  const totalGameDays = rolloutGameDays + COUNTDOWN_GAME_DAYS;
  const rolloutMs = gameDaysToRealMs(rolloutGameDays, multiplier);
  const launchMs = gameDaysToRealMs(totalGameDays, multiplier);

  return {
    rolloutGameDays,
    countdownGameDays: COUNTDOWN_GAME_DAYS,
    rolloutCompletesAt: new Date(now.getTime() + rolloutMs).toISOString(),
    scheduledLaunchAt: new Date(now.getTime() + launchMs).toISOString(),
  };
}

async function ensureEventLog(supabase, mission, event, eventType, description, extra = {}) {
  const { data: existingLog, error: lookupError } = await supabase
    .from('logs')
    .select('id')
    .eq('agency_id', mission.agency_id)
    .eq('event_type', eventType)
    .contains('data', { event_id: event.id })
    .maybeSingle();

  if (lookupError) throw new Error(`${eventType} log lookup: ${lookupError.message}`);
  if (existingLog) return;

  const { error: logError } = await supabase
    .from('logs')
    .insert([{
      agency_id: mission.agency_id,
      event_type: eventType,
      description,
      data: {
        event_id: event.id,
        mission_id: mission.id,
        mission_name: mission.name,
        ...extra,
      },
    }]);

  if (logError) throw new Error(`${eventType} log: ${logError.message}`);
}

async function handleRolloutComplete(supabase, event) {
  const missionId = event?.reference_id;
  if (!missionId) throw new Error('ROLLOUT_COMPLETE requires a mission reference');

  const { data: mission, error } = await supabase
    .from('missions')
    .select('*')
    .eq('id', missionId)
    .maybeSingle();

  if (error) throw new Error(`ROLLOUT_COMPLETE mission: ${error.message}`);
  if (!mission) throw new Error(`ROLLOUT_COMPLETE mission not found: ${missionId}`);

  const alreadyRolledOut = !['PLANNED', 'ROLLOUT'].includes(mission.status);
  const completedAt = eventTime(event);

  if (!alreadyRolledOut) {
    const { data: updated, error: updateError } = await supabase
      .from('missions')
      .update({ status: 'COUNTDOWN' })
      .eq('id', missionId)
      .in('status', ['PLANNED', 'ROLLOUT'])
      .select('id')
      .maybeSingle();

    if (updateError) throw new Error(`ROLLOUT_COMPLETE update: ${updateError.message}`);
    if (!updated) {
      return {
        mission_id: missionId,
        status: mission.status,
        completed_at: completedAt,
        already_completed: true,
      };
    }
  }

  await ensureEventLog(
    supabase,
    mission,
    event,
    'ROLLOUT_COMPLETE',
    `Rollout complete: ${mission.name}`,
    { completed_at: completedAt, scheduled_launch_at: mission.scheduled_launch_at },
  );

  return {
    mission_id: missionId,
    status: 'COUNTDOWN',
    completed_at: completedAt,
    already_completed: alreadyRolledOut,
  };
}

async function handleLaunchIgnition(supabase, event) {
  const missionId = event?.reference_id;
  if (!missionId) throw new Error('LAUNCH_IGNITION requires a mission reference');

  const { data: mission, error } = await supabase
    .from('missions')
    .select('*')
    .eq('id', missionId)
    .maybeSingle();

  if (error) throw new Error(`LAUNCH_IGNITION mission: ${error.message}`);
  if (!mission) throw new Error(`LAUNCH_IGNITION mission not found: ${missionId}`);

  const completedAt = eventTime(event);

  if (mission.status === 'ORBIT') {
    await ensureEventLog(
      supabase,
      mission,
      event,
      'ORBIT_INSERTION',
      `Orbit achieved: ${mission.name}`,
      {
        orbit: mission.outcome?.orbit || null,
        mission_seed: mission.mission_seed,
        launched_at: mission.launched_at,
      },
    );
    return {
      mission_id: missionId,
      success: true,
      status: 'ORBIT',
      orbit: mission.outcome?.orbit || null,
      completed_at: mission.launched_at || completedAt,
      already_completed: true,
    };
  }

  if (TERMINAL_MISSION_STATUSES.has(mission.status)) {
    await ensureEventLog(
      supabase,
      mission,
      event,
      'MISSION_COMPLETED',
      `Mission ${mission.result || mission.status}: ${mission.name}`,
      {
        result: mission.result || mission.status,
        mission_seed: mission.mission_seed,
        outcome: mission.outcome || null,
      },
    );
    return {
      mission_id: missionId,
      success: mission.status === 'COMPLETED',
      status: mission.status,
      outcome: mission.outcome || null,
      completed_at: mission.completed_at || completedAt,
      already_completed: true,
    };
  }

  if (!ACTIVE_MISSION_STATUSES.includes(mission.status)) {
    throw new Error(`Cannot ignite mission in status ${mission.status}`);
  }

  const [{ data: agency, error: agencyError }, { data: vehicle, error: vehicleError }] =
    await Promise.all([
      supabase.from('agencies').select('*').eq('id', mission.agency_id).maybeSingle(),
      supabase.from('vehicles').select('*').eq('id', mission.vehicle_id).maybeSingle(),
    ]);

  if (agencyError) throw new Error(`LAUNCH_IGNITION agency: ${agencyError.message}`);
  if (vehicleError) throw new Error(`LAUNCH_IGNITION vehicle: ${vehicleError.message}`);
  if (!agency) throw new Error(`LAUNCH_IGNITION agency not found: ${mission.agency_id}`);
  if (!vehicle) throw new Error(`LAUNCH_IGNITION vehicle not found: ${mission.vehicle_id}`);

  const payload = event.payload || {};
  const simulation = AGMEngine.simulateMission(
    { ...agency, rp: payload.agency_rp ?? agency.rp },
    { ...vehicle, reliability: payload.vehicle_reliability ?? vehicle.reliability },
    mission.type,
    createSeededRng(hashSeed(`${mission.mission_seed ?? mission.id}:${event.id}`)),
  );

  const multiplier = Number(payload.time_scale_multiplier) || 52.142857;
  const orbit = simulation.success
    ? planOrbit({
      missionSeed: mission.mission_seed ?? mission.id,
      missionType: mission.type,
      inclinationDeg: mission.target_inclination_deg,
      launchSiteLat: mission.launch_site_lat ?? agency.launch_site_lat,
      launchSiteLon: mission.launch_site_lon ?? agency.launch_site_lon,
      epochRealAt: completedAt,
    })
    : null;
  const orbitGameDays = simulation.success ? orbitOperationsGameDays(mission.type) : null;
  const orbitCompletesAt = simulation.success
    ? new Date(
      new Date(completedAt).getTime() + gameDaysToRealMs(orbitGameDays, multiplier),
    ).toISOString()
    : null;

  let orbitEvent = null;
  if (simulation.success) {
    const { data: createdOrbitEvent, error: orbitEventError } = await supabase
      .from('scheduled_events')
      .insert([{
        season_id: mission.season_id,
        agency_id: mission.agency_id,
        event_type: 'ORBIT_OPERATIONS_COMPLETE',
        reference_id: mission.id,
        payload: {
          agency_id: mission.agency_id,
          mission_id: mission.id,
          orbit_game_days: orbitGameDays,
          orbit,
        },
        execute_at: orbitCompletesAt,
        status: 'PENDING',
      }])
      .select()
      .single();

    if (orbitEventError || !createdOrbitEvent) {
      throw new Error(`LAUNCH_IGNITION orbit event: ${orbitEventError?.message || 'insert failed'}`);
    }
    orbitEvent = createdOrbitEvent;
  }

  const telemetry = {
    ...(mission.telemetry || {}),
    event_id: event.id,
    mission_seed: mission.mission_seed,
    final_score: simulation.finalScore,
    outcome: simulation.success ? 'SUCCESS' : 'FAILURE',
    orbit: orbit || null,
    orbit_completes_at: orbitCompletesAt,
  };

  const { data: completedMission, error: missionUpdateError } = await supabase
    .from('missions')
    .update({
      status: simulation.success ? 'ORBIT' : 'FAILED',
      result: simulation.success ? null : 'failure',
      crew_deaths: simulation.crewDeaths || 0,
      launched_at: completedAt,
      completed_at: simulation.success ? null : completedAt,
      outcome: { ...simulation, orbit },
      telemetry,
    })
    .eq('id', missionId)
    .in('status', ACTIVE_MISSION_STATUSES)
    .select('id')
    .maybeSingle();

  if (missionUpdateError) throw new Error(`LAUNCH_IGNITION update: ${missionUpdateError.message}`);
  if (!completedMission) {
    if (orbitEvent) {
      const { error: cancelError } = await supabase
        .from('scheduled_events')
        .update({ status: 'CANCELLED', last_error: 'Mission state changed before ignition' })
        .eq('id', orbitEvent.id)
        .eq('status', 'PENDING');
      if (cancelError) {
        console.error(`LAUNCH_IGNITION orbit event cancel: ${cancelError.message}`);
      }
    }
    throw new Error('Mission state changed before ignition; retry the event');
  }

  const newTotalLaunches = Number(agency.total_launches || 0) + 1;
  const newSuccessfulLaunches =
    Number(agency.successful_launches || 0) + (simulation.success ? 1 : 0);
  const newStats = {
    rp: Number(agency.rp || 0) + simulation.rpGain,
    science_points: Number(agency.science_points || 0) + simulation.scienceGain,
    funding_usd: Number(agency.funding_usd || 0),
    ipi: Math.max(0, Math.min(100, Number(agency.ipi || 0) + simulation.ipiChange)),
    si: Math.max(0, Math.min(100, Number(agency.si || 0) + simulation.siChange)),
    total_launches: newTotalLaunches,
    successful_launches: newSuccessfulLaunches,
    slr: Math.round((newSuccessfulLaunches / newTotalLaunches) * 100),
  };

  const { error: statsError } = await supabase
    .from('agencies')
    .update(newStats)
    .eq('id', mission.agency_id);
  if (statsError) throw new Error(`LAUNCH_IGNITION agency stats: ${statsError.message}`);

  const { error: vehicleUpdateError } = await supabase
    .from('vehicles')
    .update({
      status: 'testing',
      total_launches: Number(vehicle.total_launches || 0) + 1,
      successful_launches:
        Number(vehicle.successful_launches || 0) + (simulation.success ? 1 : 0),
    })
    .eq('id', vehicle.id);
  if (vehicleUpdateError) throw new Error(`LAUNCH_IGNITION vehicle stats: ${vehicleUpdateError.message}`);

  await ensureEventLog(
    supabase,
    mission,
    event,
    simulation.success ? 'ORBIT_INSERTION' : 'MISSION_COMPLETED',
    `Mission ${simulation.success ? 'achieved orbit' : 'failed'}: ${mission.name}`,
    {
      result: simulation.success ? 'orbit' : 'failure',
      mission_seed: mission.mission_seed,
      simulation_score: simulation.finalScore,
      rp_gain: simulation.rpGain,
      science_gain: simulation.scienceGain,
      ipi_change: simulation.ipiChange,
      si_change: simulation.siChange,
      crew_deaths: simulation.crewDeaths || 0,
      orbit,
      orbit_completes_at: orbitCompletesAt,
    },
  );

  return {
    mission_id: missionId,
    success: simulation.success,
    status: simulation.success ? 'ORBIT' : 'FAILED',
    outcome: { ...simulation, orbit },
    new_stats: newStats,
    orbit,
    orbit_completes_at: orbitCompletesAt,
    completed_at: completedAt,
    already_completed: false,
  };
}

async function handleOrbitOperationsComplete(supabase, event) {
  const missionId = event?.reference_id;
  if (!missionId) throw new Error('ORBIT_OPERATIONS_COMPLETE requires a mission reference');

  const { data: mission, error } = await supabase
    .from('missions')
    .select('*')
    .eq('id', missionId)
    .maybeSingle();

  if (error) throw new Error(`ORBIT_OPERATIONS_COMPLETE mission: ${error.message}`);
  if (!mission) throw new Error(`ORBIT_OPERATIONS_COMPLETE mission not found: ${missionId}`);

  const completedAt = eventTime(event);
  const alreadyCompleted = mission.status !== 'ORBIT';

  if (!alreadyCompleted) {
    const { data: updated, error: updateError } = await supabase
      .from('missions')
      .update({
        status: 'COMPLETED',
        result: 'success',
        completed_at: completedAt,
        telemetry: {
          ...(mission.telemetry || {}),
          orbit_completed_at: completedAt,
          orbit_operations_game_days: event.payload?.orbit_game_days ?? null,
        },
      })
      .eq('id', missionId)
      .eq('status', 'ORBIT')
      .select('id')
      .maybeSingle();

    if (updateError) throw new Error(`ORBIT_OPERATIONS_COMPLETE update: ${updateError.message}`);
    if (!updated) {
      throw new Error('Mission state changed before orbit completion; retry the event');
    }
  }

  await ensureEventLog(
    supabase,
    mission,
    event,
    'MISSION_COMPLETED',
    `Mission completed orbital operations: ${mission.name}`,
    {
      result: 'success',
      phase: 'ORBIT_OPERATIONS',
      mission_seed: mission.mission_seed,
      orbit: mission.outcome?.orbit || null,
      orbit_operations_game_days: event.payload?.orbit_game_days ?? null,
      completed_at: completedAt,
    },
  );

  return {
    mission_id: missionId,
    status: 'COMPLETED',
    completed_at: completedAt,
    already_completed: alreadyCompleted,
  };
}

module.exports = {
  ROLLOUT_MIN_GAME_DAYS,
  ROLLOUT_MAX_GAME_DAYS,
  COUNTDOWN_GAME_DAYS,
  ACTIVE_MISSION_STATUSES,
  RESOLVED_MISSION_STATUSES,
  planLaunchSchedule,
  handleRolloutComplete,
  handleLaunchIgnition,
  handleOrbitOperationsComplete,
};
