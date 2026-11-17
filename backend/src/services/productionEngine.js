const PRODUCTION_GAME_DAYS = Object.freeze({
  'sounding-rocket': 30,
  'orbital-rocket': 90,
  'satellite': 60,
  'capsule': 120,
  'probe': 75,
  'lander': 150,
});

const DEFAULT_PRODUCTION_GAME_DAYS = 60;

function productionGameDaysForType(vehicleType) {
  return PRODUCTION_GAME_DAYS[vehicleType] || DEFAULT_PRODUCTION_GAME_DAYS;
}

function eventCompletionTime(event) {
  const date = event?.execute_at ? new Date(event.execute_at) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

async function ensureProductionLog(supabase, vehicle, event, completedAt) {
  const { data: existingLog, error: lookupError } = await supabase
    .from('logs')
    .select('id')
    .eq('agency_id', vehicle.agency_id)
    .eq('event_type', 'PRODUCTION_COMPLETED')
    .contains('data', { event_id: event.id })
    .maybeSingle();

  if (lookupError) throw new Error(`PRODUCTION_COMPLETE log lookup: ${lookupError.message}`);
  if (existingLog) return;

  const { error: logError } = await supabase
    .from('logs')
    .insert([{
      agency_id: vehicle.agency_id,
      event_type: 'PRODUCTION_COMPLETED',
      description: `Vehicle produced: ${vehicle.name} (${vehicle.type})`,
      data: {
        event_id: event.id,
        vehicle_id: vehicle.id,
        vehicle_name: vehicle.name,
        vehicle_type: vehicle.type,
        completed_at: completedAt,
      },
    }]);

  if (logError) throw new Error(`PRODUCTION_COMPLETE log: ${logError.message}`);
}

async function handleProductionComplete(supabase, event) {
  const vehicleId = event?.reference_id;
  if (!vehicleId) throw new Error('PRODUCTION_COMPLETE requires a vehicle reference');

  const { data: vehicle, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .maybeSingle();

  if (error) throw new Error(`PRODUCTION_COMPLETE vehicle: ${error.message}`);
  if (!vehicle) throw new Error(`PRODUCTION_COMPLETE vehicle not found: ${vehicleId}`);

  const alreadyCompleted = vehicle.status !== 'manufacturing';

  if (!alreadyCompleted) {
    const { data: updated, error: updateError } = await supabase
      .from('vehicles')
      .update({ status: 'testing' })
      .eq('id', vehicleId)
      .eq('status', 'manufacturing')
      .select('id')
      .maybeSingle();

    if (updateError) throw new Error(`PRODUCTION_COMPLETE update: ${updateError.message}`);
    if (!updated) {
      return {
        vehicle_id: vehicleId,
        status: vehicle.status,
        completed_at: eventCompletionTime(event),
        already_completed: true,
      };
    }
  }

  const completedAt = eventCompletionTime(event);
  await ensureProductionLog(supabase, vehicle, event, completedAt);

  return {
    vehicle_id: vehicleId,
    status: 'testing',
    completed_at: completedAt,
    already_completed: alreadyCompleted,
  };
}

module.exports = {
  PRODUCTION_GAME_DAYS,
  DEFAULT_PRODUCTION_GAME_DAYS,
  productionGameDaysForType,
  handleProductionComplete,
};
