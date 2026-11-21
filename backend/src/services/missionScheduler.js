const { randomUUID } = require('node:crypto');
const { loadActiveSeason, MS_PER_DAY } = require('./gameClock');
const { hashSeed } = require('./seededRng');
const {
  evaluateMissionFeasibility,
  feasibilityErrorMessage,
} = require('./missionFeasibility');
const { ACTIVE_MISSION_STATUSES, planLaunchSchedule } = require('./missionPlan');
const { azimuthForInclination } = require('./orbitalEngine');
const { recordAuditEvent } = require('./auditLog');
const {
  MISSION_TYPES,
  EconomyError,
  resolveContractForMission,
} = require('./economyEngine');

const IN_FLIGHT_VEHICLE_STATUSES = new Set(['manufacturing', 'assigned']);

class MissionScheduleError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'MissionScheduleError';
    this.status = status;
    this.details = details;
  }
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function scheduleMission({
  supabase,
  agencyId,
  missionName,
  vehicleId,
  missionType,
  targetInclinationDeg,
  azimuthDeg,
  contractId,
  contractKey,
  queueId,
  source = 'direct',
}) {
  if (!agencyId || !missionName || !vehicleId || !missionType) {
    throw new MissionScheduleError(400, 'Missing required fields');
  }
  if (!MISSION_TYPES.has(missionType)) {
    throw new MissionScheduleError(400, `Unknown mission type: ${missionType}`);
  }

  const targetInclinationInput = optionalNumber(targetInclinationDeg);
  const azimuthInput = optionalNumber(azimuthDeg);

  const hasInclinationInput =
    targetInclinationDeg !== undefined && targetInclinationDeg !== null && targetInclinationDeg !== '';
  const hasAzimuthInput =
    azimuthDeg !== undefined && azimuthDeg !== null && azimuthDeg !== '';

  if (hasInclinationInput && targetInclinationInput === null) {
    throw new MissionScheduleError(400, 'targetInclinationDeg must be a number between 0 and 180');
  }
  if (targetInclinationInput !== null && (targetInclinationInput < 0 || targetInclinationInput > 180)) {
    throw new MissionScheduleError(400, 'targetInclinationDeg must be between 0 and 180');
  }
  if (hasAzimuthInput && azimuthInput === null) {
    throw new MissionScheduleError(400, 'azimuthDeg must be a number between 0 and 360');
  }
  if (azimuthInput !== null && (azimuthInput < 0 || azimuthInput > 360)) {
    throw new MissionScheduleError(400, 'azimuthDeg must be between 0 and 360');
  }

  const [
    { data: agency, error: agencyError },
    { data: vehicle, error: vehicleError },
    season,
    contract,
  ] = await Promise.all([
    supabase.from('agencies').select('*').eq('id', agencyId).single(),
    supabase.from('vehicles').select('*').eq('id', vehicleId).single(),
    loadActiveSeason(supabase),
    resolveContractForMission(supabase, {
      agencyId,
      contractId,
      contractKey,
      missionType,
    }).catch((error) => {
      if (error instanceof EconomyError || error instanceof MissionScheduleError) throw error;
      throw new MissionScheduleError(500, error.message);
    }),
  ]);

  if (agencyError || !agency) {
    throw new MissionScheduleError(404, 'Agency not found');
  }
  if (vehicleError || !vehicle) {
    throw new MissionScheduleError(404, 'Vehicle not found');
  }
  if (vehicle.agency_id !== agencyId) {
    throw new MissionScheduleError(403, 'Vehicle does not belong to this agency');
  }
  if (IN_FLIGHT_VEHICLE_STATUSES.has(vehicle.status)) {
    throw new MissionScheduleError(
      400,
      vehicle.status === 'manufacturing'
        ? 'Vehicle is still in production'
        : 'Vehicle is already assigned to another mission',
    );
  }

  if (source !== 'queue') {
    const { data: activeQueueItem, error: queueError } = await supabase
      .from('mission_queue')
      .select('id, name')
      .eq('agency_id', agencyId)
      .eq('status', 'ACTIVE')
      .limit(1)
      .maybeSingle();

    if (queueError && String(queueError.message || '').includes('does not exist')) {
      throw new MissionScheduleError(503, 'Economy migration is not applied yet');
    }
    if (queueError) throw new MissionScheduleError(500, `mission queue: ${queueError.message}`);
    if (activeQueueItem) {
      throw new MissionScheduleError(
        409,
        `Mission queue is active (${activeQueueItem.name}); wait or cancel it first`,
      );
    }
  }

  const { data: activeMission, error: activeMissionError } = await supabase
    .from('missions')
    .select('id')
    .eq('vehicle_id', vehicleId)
    .in('status', ACTIVE_MISSION_STATUSES)
    .limit(1)
    .maybeSingle();

  if (activeMissionError) throw new Error(`active mission: ${activeMissionError.message}`);
  if (activeMission) {
    throw new MissionScheduleError(400, 'Vehicle already has an active mission');
  }

  const launchSiteLat = Number(agency.launch_site_lat || 0);
  const launchSiteLon = Number(agency.launch_site_lon || 0);
  const targetInclination =
    targetInclinationInput === null ? Math.abs(launchSiteLat) : targetInclinationInput;
  if (targetInclination < Math.abs(launchSiteLat)) {
    throw new MissionScheduleError(
      400,
      `targetInclinationDeg cannot be below the launch site latitude (${Math.abs(launchSiteLat)})`,
    );
  }

  const computedAzimuth = azimuthInput === null
    ? azimuthForInclination(launchSiteLat, targetInclination)
    : azimuthInput;
  if (computedAzimuth === null) {
    throw new MissionScheduleError(
      400,
      'Target inclination is unreachable from this launch site without a plane change',
    );
  }

  const feasibility = evaluateMissionFeasibility({
    agency,
    vehicle,
    missionType,
    targetInclinationDeg: targetInclination,
    launchSiteLat,
  });
  if (!feasibility.feasible) {
    throw new MissionScheduleError(
      400,
      feasibilityErrorMessage(feasibility),
      { feasibility },
    );
  }

  const missionCost = feasibility.estimated_cost;
  const durationPlan = feasibility.estimated_duration;
  const multiplier = Number(season.time_scale_multiplier) || 52.142857;
  const missionSeed = hashSeed(randomUUID());
  const schedule = planLaunchSchedule({
    missionSeed,
    multiplier,
    now: new Date(),
    preparationGameDays: durationPlan.preparation_complexity_game_days,
  });
  const duration = {
    ...durationPlan,
    rollout_game_days: schedule.rolloutGameDays,
    countdown_game_days: schedule.countdownGameDays,
    total_game_days:
      schedule.rolloutGameDays
      + schedule.countdownGameDays
      + durationPlan.orbit_operations_game_days,
  };

  const scheduledLaunchMs = new Date(schedule.scheduledLaunchAt).getTime() - Date.now();
  const scheduledLaunchDays = Math.max(1, Math.ceil(scheduledLaunchMs / MS_PER_DAY));
  const newFunding = Number(agency.funding_usd || 0) - missionCost.funding_usd;
  const seasonId = agency.season_id || season.id;

  let mission = null;
  let rolloutEvent = null;
  let ignitionEvent = null;
  let missionWritten = false;
  let vehicleReserved = false;
  let agencyWritten = false;

  try {
    const { data: createdMission, error: missionError } = await supabase
      .from('missions')
      .insert([{
        agency_id: agencyId,
        season_id: seasonId,
        name: missionName,
        vehicle_id: vehicleId,
        type: missionType,
        result: null,
        ap_cost: 0,
        budget_cost: 0,
        crew_deaths: 0,
        status: 'ROLLOUT',
        scheduled_launch_at: schedule.scheduledLaunchAt,
        launch_site_lat: launchSiteLat,
        launch_site_lon: launchSiteLon,
        target_inclination_deg: targetInclination,
        azimuth_deg: computedAzimuth,
        mission_seed: missionSeed,
        contract_id: contract?.id || null,
        queue_id: queueId || null,
        telemetry: {
          rollout_game_days: schedule.rolloutGameDays,
          countdown_game_days: schedule.countdownGameDays,
          rollout_completes_at: schedule.rolloutCompletesAt,
          scheduled_launch_at: schedule.scheduledLaunchAt,
          time_scale_multiplier: multiplier,
          cost_funding_usd: missionCost.funding_usd,
          cost: missionCost,
          duration,
          contract_id: contract?.id || null,
          contract_key: contract?.contract_key || null,
          queue_id: queueId || null,
          feasibility,
        },
      }])
      .select()
      .single();

    if (missionError || !createdMission) {
      throw new Error(`missions: ${missionError?.message || 'insert failed'}`);
    }
    mission = createdMission;
    missionWritten = true;

    const { data: reservedVehicle, error: reserveError } = await supabase
      .from('vehicles')
      .update({ status: 'assigned' })
      .eq('id', vehicleId)
      .eq('status', vehicle.status)
      .select('id')
      .maybeSingle();

    if (reserveError) throw new Error(`vehicle reserve: ${reserveError.message}`);
    if (!reservedVehicle) throw new Error('Vehicle state changed; retry the request');
    vehicleReserved = true;

    const { data: updatedAgency, error: agencyUpdateError } = await supabase
      .from('agencies')
      .update({ funding_usd: newFunding })
      .eq('id', agencyId)
      .eq('funding_usd', agency.funding_usd)
      .select('id')
      .maybeSingle();

    if (agencyUpdateError) throw new Error(`agencies update: ${agencyUpdateError.message}`);
    if (!updatedAgency) throw new Error('Agency resources changed; retry the request');
    agencyWritten = true;

    const payload = {
      agency_id: agencyId,
      mission_id: mission.id,
      mission_name: missionName,
      vehicle_id: vehicleId,
      vehicle_name: vehicle.name,
      vehicle_type: vehicle.type,
      vehicle_reliability: vehicle.reliability,
      agency_rp: agency.rp,
      mission_seed: missionSeed,
      time_scale_multiplier: multiplier,
      launch_site_lat: launchSiteLat,
      launch_site_lon: launchSiteLon,
      target_inclination_deg: targetInclination,
      azimuth_deg: computedAzimuth,
      rollout_game_days: schedule.rolloutGameDays,
      countdown_game_days: schedule.countdownGameDays,
      rollout_completes_at: schedule.rolloutCompletesAt,
      scheduled_launch_at: schedule.scheduledLaunchAt,
      contract_id: contract?.id || null,
      contract_key: contract?.contract_key || null,
      queue_id: queueId || null,
      cost: missionCost,
      duration,
      feasibility,
    };

    const { data: rolloutRow, error: rolloutError } = await supabase
      .from('scheduled_events')
      .insert([{
        season_id: seasonId,
        agency_id: agencyId,
        event_type: 'ROLLOUT_COMPLETE',
        reference_id: mission.id,
        payload,
        execute_at: schedule.rolloutCompletesAt,
        status: 'PENDING',
      }])
      .select()
      .single();

    if (rolloutError || !rolloutRow) {
      throw new Error(`rollout event: ${rolloutError?.message || 'insert failed'}`);
    }
    rolloutEvent = rolloutRow;

    const { data: ignitionRow, error: ignitionError } = await supabase
      .from('scheduled_events')
      .insert([{
        season_id: seasonId,
        agency_id: agencyId,
        event_type: 'LAUNCH_IGNITION',
        reference_id: mission.id,
        payload,
        execute_at: schedule.scheduledLaunchAt,
        status: 'PENDING',
      }])
      .select()
      .single();

    if (ignitionError || !ignitionRow) {
      throw new Error(`ignition event: ${ignitionError?.message || 'insert failed'}`);
    }
    ignitionEvent = ignitionRow;

    const { error: logError } = await supabase
      .from('logs')
      .insert([{
        agency_id: agencyId,
        event_type: 'LAUNCH_SCHEDULED',
        description: `Launch scheduled: ${missionName}`,
        data: {
          mission_id: mission.id,
          mission_name: missionName,
          mission_type: missionType,
          vehicle_id: vehicleId,
          mission_seed: missionSeed,
          contract_id: contract?.id || null,
          contract_key: contract?.contract_key || null,
          queue_id: queueId || null,
          rollout_event_id: rolloutRow.id,
          ignition_event_id: ignitionRow.id,
          cost_funding_usd: missionCost.funding_usd,
          cost: missionCost,
          duration,
          total_mission_game_days: duration.total_game_days,
          rollout_completes_at: schedule.rolloutCompletesAt,
          scheduled_launch_at: schedule.scheduledLaunchAt,
          launch_site_lat: launchSiteLat,
          launch_site_lon: launchSiteLon,
          target_inclination_deg: targetInclination,
          azimuth_deg: computedAzimuth,
          feasibility,
        },
      }]);

    if (logError) throw new Error(`logs: ${logError.message}`);

    await recordAuditEvent(supabase, {
      actorType: 'agency',
      actorId: agencyId,
      seasonId,
      agencyId,
      action: 'MISSION_SCHEDULED',
      entityType: 'mission',
      entityId: mission.id,
      beforeData: { funding_usd: Number(agency.funding_usd || 0) },
      afterData: { funding_usd: newFunding },
      deltaData: { funding_usd: -missionCost.funding_usd },
      metadata: {
        mission_name: missionName,
        mission_type: missionType,
        vehicle_id: vehicleId,
        contract_id: contract?.id || null,
        contract_key: contract?.contract_key || null,
        queue_id: queueId || null,
        source,
        cost_funding_usd: missionCost.funding_usd,
        total_mission_game_days: duration.total_game_days,
      },
    });
  } catch (error) {
    const rollbackErrors = [];

    for (const pendingEvent of [ignitionEvent, rolloutEvent]) {
      if (!pendingEvent) continue;
      const { error: cancelError } = await supabase
        .from('scheduled_events')
        .update({ status: 'CANCELLED', last_error: error.message })
        .eq('id', pendingEvent.id)
        .eq('status', 'PENDING');
      if (cancelError) rollbackErrors.push(cancelError.message);
    }

    if (agencyWritten) {
      const { error: restoreAgencyError } = await supabase
        .from('agencies')
        .update({ funding_usd: agency.funding_usd })
        .eq('id', agencyId);
      if (restoreAgencyError) rollbackErrors.push(restoreAgencyError.message);
    }

    if (vehicleReserved) {
      const { error: releaseError } = await supabase
        .from('vehicles')
        .update({ status: vehicle.status })
        .eq('id', vehicleId)
        .eq('status', 'assigned');
      if (releaseError) rollbackErrors.push(releaseError.message);
    }

    if (missionWritten) {
      const { error: deleteMissionError } = await supabase
        .from('missions')
        .delete()
        .eq('id', mission.id);
      if (deleteMissionError) rollbackErrors.push(deleteMissionError.message);
    }

    if (rollbackErrors.length > 0) {
      console.error('Launch scheduling rollback failed:', rollbackErrors.join('; '));
    }

    throw error;
  }

  return {
    message: 'Launch scheduled',
    mission,
    missionSeed,
    feasibility,
    missionCost,
    duration,
    rolloutGameDays: schedule.rolloutGameDays,
    countdownGameDays: schedule.countdownGameDays,
    rolloutCompletesAt: schedule.rolloutCompletesAt,
    scheduledLaunchAt: schedule.scheduledLaunchAt,
    scheduledLaunchDays,
    events: {
      rolloutEventId: rolloutEvent.id,
      ignitionEventId: ignitionEvent.id,
    },
    newStats: {
      funding_usd: newFunding,
      science_points: Number(agency.science_points || 0),
      rp: agency.rp,
      ipi: agency.ipi,
      si: agency.si,
      slr: agency.slr,
    },
  };
}

module.exports = {
  MissionScheduleError,
  scheduleMission,
};
