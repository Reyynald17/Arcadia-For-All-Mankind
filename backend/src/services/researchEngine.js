const COORDINATION_EXPONENT = 0.65;
const PREREQ_TRL_BONUS = 0.15;
const DEFAULT_OPTIMAL_ENGINEERS = 20;

function calculateResearchDurationDays({
  baseDays,
  engineers,
  prereqTrlCount = 0,
  optimalEngineers = DEFAULT_OPTIMAL_ENGINEERS,
}) {
  const base = Number(baseDays);
  if (!Number.isFinite(base) || base <= 0) return 0;

  const assigned = Number(engineers);
  if (!Number.isFinite(assigned) || assigned <= 0) return base;

  const optimal = Number(optimalEngineers);
  const safeOptimal =
    Number.isFinite(optimal) && optimal > 0 ? optimal : DEFAULT_OPTIMAL_ENGINEERS;

  const teamFactor = (assigned / safeOptimal) ** COORDINATION_EXPONENT;
  const prerequisiteFactor = 1 + PREREQ_TRL_BONUS * Math.max(0, Number(prereqTrlCount) || 0);
  const denominator = Math.max(teamFactor * prerequisiteFactor, 1e-6);

  return base / denominator;
}

function assignedEngineersForAgency(
  agency,
  requestedEngineers,
  optimalEngineers = DEFAULT_OPTIMAL_ENGINEERS,
) {
  const total = Math.max(0, Math.floor(Number(agency?.total_engineers) || 0));
  const hasRequest =
    requestedEngineers !== undefined && requestedEngineers !== null && requestedEngineers !== '';
  const target = hasRequest ? Number(requestedEngineers) : optimalEngineers;

  if (!Number.isFinite(target) || target <= 0) return 0;
  return Math.min(total, Math.floor(target));
}

function eventCompletionTime(event) {
  const parsed = new Date(event?.execute_at || Date.now());
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

async function handleTechComplete(supabase, event) {
  const agencyId = event?.agency_id || event?.payload?.agency_id;
  const nodeId = event?.reference_id || event?.payload?.node_id;

  if (!agencyId || !nodeId) {
    throw new Error('TECH_COMPLETE is missing agency_id or node_id');
  }

  const { data: tech, error: techError } = await supabase
    .from('technologies')
    .select('node_id, name, unlock_trl')
    .eq('node_id', nodeId)
    .single();

  if (techError || !tech) {
    throw new Error(`TECH_COMPLETE technology not found: ${nodeId}`);
  }

  const { data: node, error: nodeError } = await supabase
    .from('agency_tech_nodes')
    .select('status, current_trl')
    .eq('agency_id', agencyId)
    .eq('node_id', nodeId)
    .maybeSingle();

  if (nodeError) throw new Error(`TECH_COMPLETE node lookup: ${nodeError.message}`);
  if (!node) throw new Error(`TECH_COMPLETE agency node not found: ${agencyId}/${nodeId}`);
  if (!['RESEARCHING', 'UNLOCKED'].includes(node.status)) {
    throw new Error(`TECH_COMPLETE requires RESEARCHING or UNLOCKED, found ${node.status}`);
  }

  const completedAt = eventCompletionTime(event);
  const unlockTrl = Number(tech.unlock_trl ?? 4);
  const alreadyUnlocked = node.status === 'UNLOCKED';

  if (!alreadyUnlocked) {
    const { error: updateError } = await supabase
      .from('agency_tech_nodes')
      .update({
        status: 'UNLOCKED',
        current_trl: unlockTrl,
        research_completes_at: completedAt,
      })
      .eq('agency_id', agencyId)
      .eq('node_id', nodeId)
      .eq('status', 'RESEARCHING');

    if (updateError) throw new Error(`TECH_COMPLETE unlock: ${updateError.message}`);
  }

  const eventId = String(event.id ?? '');
  const { data: existingLog, error: logLookupError } = await supabase
    .from('logs')
    .select('id')
    .eq('agency_id', agencyId)
    .eq('event_type', 'RESEARCH_COMPLETED')
    .contains('data', { event_id: eventId })
    .maybeSingle();

  if (logLookupError) throw new Error(`TECH_COMPLETE log lookup: ${logLookupError.message}`);

  if (!existingLog) {
    const { error: logError } = await supabase
      .from('logs')
      .insert([{
        agency_id: agencyId,
        event_type: 'RESEARCH_COMPLETED',
        description: `Research completed: ${tech.name}`,
        data: {
          technology: tech.name,
          node_id: nodeId,
          event_id: eventId,
          completed_at: completedAt,
          duration_days: event.payload?.duration_days ?? null,
          duration_game_days: event.payload?.duration_game_days ?? null,
          assigned_engineers: event.payload?.assigned_engineers ?? null,
        },
      }]);

    if (logError) throw new Error(`TECH_COMPLETE log insert: ${logError.message}`);
  }

  return {
    node_id: nodeId,
    technology: tech.name,
    current_trl: unlockTrl,
    completed_at: completedAt,
    already_unlocked: alreadyUnlocked,
  };
}

module.exports = {
  COORDINATION_EXPONENT,
  PREREQ_TRL_BONUS,
  DEFAULT_OPTIMAL_ENGINEERS,
  calculateResearchDurationDays,
  assignedEngineersForAgency,
  handleTechComplete,
};
