const { ACTIVE_MISSION_STATUSES } = require('./missionPlan');
const { MissionScheduleError, scheduleMission } = require('./missionScheduler');
const {
  MISSION_TYPES,
  EconomyError,
  getContract,
  resolveContractForMission,
} = require('./economyEngine');

const READY_VEHICLE_STATUSES = new Set(['testing', 'nominal', 'retired']);
const QUEUE_ACTIVE_STATUSES = ['QUEUED', 'ACTIVE'];

class MissionQueueError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'MissionQueueError';
    this.status = status;
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

function presentQueueItem(item) {
  const contract = item.contract_key ? getContract(item.contract_key) : null;
  return {
    ...item,
    contract_name: contract?.name || null,
    contract_mission_type: contract?.missionType || null,
  };
}

async function listMissionQueue(supabase, agencyId) {
  const [queueResult, missionResult] = await Promise.all([
    supabase
      .from('mission_queue')
      .select('*')
      .eq('agency_id', agencyId)
      .order('created_at', { ascending: true }),
    supabase
      .from('missions')
      .select('id, name, status, type, scheduled_launch_at, vehicle_id')
      .eq('agency_id', agencyId)
      .in('status', ACTIVE_MISSION_STATUSES)
      .limit(1)
      .maybeSingle(),
  ]);

  if (queueResult.error) {
    if (migrationMissing(queueResult.error)) {
      throw new MissionQueueError(503, 'Economy migration is not applied yet');
    }
    throw new MissionQueueError(500, `mission queue: ${queueResult.error.message}`);
  }
  if (missionResult.error) {
    throw new MissionQueueError(500, `active mission: ${missionResult.error.message}`);
  }

  return {
    queue: (queueResult.data || []).map(presentQueueItem),
    activeMission: missionResult.data || null,
  };
}

async function enqueueMission({
  supabase,
  agencyId,
  missionName,
  vehicleId,
  missionType,
  targetInclinationDeg,
  azimuthDeg,
  contractKey,
}) {
  if (!agencyId || !missionName || !vehicleId || !missionType) {
    throw new MissionQueueError(400, 'Missing required fields');
  }
  if (!MISSION_TYPES.has(missionType)) {
    throw new MissionQueueError(400, `Unknown mission type: ${missionType}`);
  }

  const [{ data: agency, error: agencyError }, { data: vehicle, error: vehicleError }] =
    await Promise.all([
      supabase.from('agencies').select('*').eq('id', agencyId).single(),
      supabase.from('vehicles').select('*').eq('id', vehicleId).single(),
    ]);

  if (agencyError || !agency) throw new MissionQueueError(404, 'Agency not found');
  if (vehicleError || !vehicle) throw new MissionQueueError(404, 'Vehicle not found');
  if (vehicle.agency_id !== agencyId) {
    throw new MissionQueueError(403, 'Vehicle does not belong to this agency');
  }
  if (!READY_VEHICLE_STATUSES.has(vehicle.status)) {
    throw new MissionQueueError(
      400,
      vehicle.status === 'manufacturing'
        ? 'Vehicle is still in production'
        : 'Vehicle is already assigned to another mission',
    );
  }

  let contract = null;
  if (contractKey) {
    try {
      contract = await resolveContractForMission(supabase, {
        agencyId,
        contractKey,
        missionType,
      });
    } catch (error) {
      if (error instanceof EconomyError) {
        throw new MissionQueueError(error.status, error.message);
      }
      throw error;
    }

    const { data: contractInQueue, error: contractQueueError } = await supabase
      .from('mission_queue')
      .select('id')
      .eq('contract_id', contract.id)
      .in('status', QUEUE_ACTIVE_STATUSES)
      .limit(1)
      .maybeSingle();

    if (contractQueueError) {
      throw new MissionQueueError(500, `contract queue: ${contractQueueError.message}`);
    }
    if (contractInQueue) {
      throw new MissionQueueError(400, 'Contract already has a queued or active mission');
    }
  }

  const { data: duplicate, error: duplicateError } = await supabase
    .from('mission_queue')
    .select('id')
    .eq('vehicle_id', vehicleId)
    .in('status', QUEUE_ACTIVE_STATUSES)
    .limit(1)
    .maybeSingle();

  if (duplicateError) {
    throw new MissionQueueError(500, `vehicle queue: ${duplicateError.message}`);
  }
  if (duplicate) {
    throw new MissionQueueError(400, 'Vehicle already has a queued or active mission');
  }

  const { data: queueItem, error: insertError } = await supabase
    .from('mission_queue')
    .insert([{
      agency_id: agencyId,
      season_id: agency.season_id || null,
      name: missionName,
      vehicle_id: vehicleId,
      mission_type: missionType,
      contract_id: contract?.id || null,
      contract_key: contract?.contract_key || null,
      target_inclination_deg: targetInclinationDeg ?? null,
      azimuth_deg: azimuthDeg ?? null,
      status: 'QUEUED',
    }])
    .select()
    .single();

  if (insertError) {
    if (migrationMissing(insertError)) {
      throw new MissionQueueError(503, 'Economy migration is not applied yet');
    }
    throw new MissionQueueError(500, `mission queue insert: ${insertError.message}`);
  }

  const promotion = await promoteNextMission(supabase, agencyId);
  return {
    queueItem: presentQueueItem(queueItem),
    promotion,
  };
}

async function promoteNextMission(supabase, agencyId) {
  const { data: activeQueueItem, error: activeQueueError } = await supabase
    .from('mission_queue')
    .select('id, name')
    .eq('agency_id', agencyId)
    .eq('status', 'ACTIVE')
    .limit(1)
    .maybeSingle();

  if (activeQueueError) {
    if (migrationMissing(activeQueueError)) {
      return { promoted: false, reason: 'MIGRATION_REQUIRED' };
    }
    throw new Error(`active queue item: ${activeQueueError.message}`);
  }
  if (activeQueueItem) {
    return { promoted: false, reason: 'QUEUE_ACTIVE', queueItemId: activeQueueItem.id };
  }

  const { data: activeMission, error: activeMissionError } = await supabase
    .from('missions')
    .select('id, name, status')
    .eq('agency_id', agencyId)
    .in('status', ACTIVE_MISSION_STATUSES)
    .limit(1)
    .maybeSingle();

  if (activeMissionError) throw new Error(`active mission: ${activeMissionError.message}`);
  if (activeMission) {
    return { promoted: false, reason: 'MISSION_ACTIVE', missionId: activeMission.id };
  }

  const { data: nextItem, error: nextError } = await supabase
    .from('mission_queue')
    .select('*')
    .eq('agency_id', agencyId)
    .eq('status', 'QUEUED')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (nextError) {
    if (migrationMissing(nextError)) {
      return { promoted: false, reason: 'MIGRATION_REQUIRED' };
    }
    throw new Error(`next queue item: ${nextError.message}`);
  }
  if (!nextItem) return { promoted: false, reason: 'QUEUE_EMPTY' };

  const { data: claimed, error: claimError } = await supabase
    .from('mission_queue')
    .update({
      status: 'ACTIVE',
      started_at: new Date().toISOString(),
      error: null,
    })
    .eq('id', nextItem.id)
    .eq('status', 'QUEUED')
    .select('*')
    .maybeSingle();

  if (claimError) throw new Error(`claim queue item: ${claimError.message}`);
  if (!claimed) return { promoted: false, reason: 'QUEUE_CLAIMED' };

  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', nextItem.vehicle_id)
    .maybeSingle();

  if (vehicleError) throw new Error(`queue vehicle: ${vehicleError.message}`);

  try {
    if (!vehicle) throw new MissionQueueError(404, 'Vehicle not found');
    if (!READY_VEHICLE_STATUSES.has(vehicle.status)) {
      throw new MissionQueueError(400, `Vehicle is ${vehicle.status}, not ready for launch`);
    }

    const result = await scheduleMission({
      supabase,
      agencyId,
      missionName: nextItem.name,
      vehicleId: nextItem.vehicle_id,
      missionType: nextItem.mission_type,
      targetInclinationDeg: nextItem.target_inclination_deg,
      azimuthDeg: nextItem.azimuth_deg,
      contractId: nextItem.contract_id,
      queueId: nextItem.id,
      source: 'queue',
    });

    const { data: updatedItem, error: updateError } = await supabase
      .from('mission_queue')
      .update({ mission_id: result.mission.id })
      .eq('id', nextItem.id)
      .select()
      .maybeSingle();

    if (updateError) throw new Error(`queue mission link: ${updateError.message}`);

    return {
      promoted: true,
      queueItem: presentQueueItem(updatedItem || claimed),
      mission: result.mission,
      schedule: {
        rolloutCompletesAt: result.rolloutCompletesAt,
        scheduledLaunchAt: result.scheduledLaunchAt,
      },
    };
  } catch (error) {
    const message = error instanceof MissionScheduleError || error instanceof MissionQueueError
      ? error.message
      : error.message || 'Queue promotion failed';

    const { error: failError } = await supabase
      .from('mission_queue')
      .update({
        status: 'FAILED',
        error: message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', nextItem.id)
      .eq('status', 'ACTIVE');

    if (failError) {
      console.error(`queue promotion failure update: ${failError.message}`);
    }

    return {
      promoted: false,
      reason: 'PROMOTION_FAILED',
      error: message,
      queueItemId: nextItem.id,
    };
  }
}

async function completeQueueItem(supabase, missionId, status, error = null) {
  if (!missionId) return null;

  const { data: item, error: lookupError } = await supabase
    .from('mission_queue')
    .select('id, status')
    .eq('mission_id', missionId)
    .maybeSingle();

  if (lookupError) {
    if (migrationMissing(lookupError)) return null;
    throw new Error(`queue item lookup: ${lookupError.message}`);
  }
  if (!item || item.status !== 'ACTIVE') return item || null;

  const { data: updated, error: updateError } = await supabase
    .from('mission_queue')
    .update({
      status,
      error,
      completed_at: new Date().toISOString(),
    })
    .eq('id', item.id)
    .eq('status', 'ACTIVE')
    .select()
    .maybeSingle();

  if (updateError) throw new Error(`queue item completion: ${updateError.message}`);
  return updated;
}

async function cancelQueueItem(supabase, agencyId, queueId) {
  const { data: item, error: lookupError } = await supabase
    .from('mission_queue')
    .select('*')
    .eq('id', queueId)
    .eq('agency_id', agencyId)
    .maybeSingle();

  if (lookupError) {
    if (migrationMissing(lookupError)) {
      throw new MissionQueueError(503, 'Economy migration is not applied yet');
    }
    throw new MissionQueueError(500, `queue lookup: ${lookupError.message}`);
  }
  if (!item) throw new MissionQueueError(404, 'Queue item not found');
  if (item.status !== 'QUEUED') {
    throw new MissionQueueError(400, `Only QUEUED missions can be cancelled (found ${item.status})`);
  }

  const { data: updated, error: updateError } = await supabase
    .from('mission_queue')
    .update({
      status: 'CANCELLED',
      completed_at: new Date().toISOString(),
    })
    .eq('id', queueId)
    .eq('status', 'QUEUED')
    .select()
    .maybeSingle();

  if (updateError) throw new MissionQueueError(500, `queue cancel: ${updateError.message}`);
  return presentQueueItem(updated || item);
}

module.exports = {
  MissionQueueError,
  listMissionQueue,
  enqueueMission,
  promoteNextMission,
  completeQueueItem,
  cancelQueueItem,
};
