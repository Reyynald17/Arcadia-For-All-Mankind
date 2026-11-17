const { gameDaysToRealMs } = require('./gameClock');
const { hashSeed, createSeededRng } = require('./seededRng');

const XP_BASE = 100;
const XP_GROWTH = 1.6;
const FAILURE_DECAY = 0.55;
const STATIC_FIRE_MIN_GAME_DAYS = 15;
const STATIC_FIRE_MAX_GAME_DAYS = 30;
const DEFAULT_RATED_BURN_SECONDS = 180;

function clamp01(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

function xpRequired(level) {
  const trl = Math.max(4, Math.min(9, Math.floor(Number(level) || 4)));
  return XP_BASE * XP_GROWTH ** (trl - 4);
}

function failureProbability({
  currentTrl,
  unlockTrl = 4,
  baseFailureRate = 0.15,
  minFailureRate = 0.008,
}) {
  const trl = Math.max(0, Math.min(9, Math.floor(Number(currentTrl) || 0)));
  const unlock = Math.max(0, Math.min(9, Math.floor(Number(unlockTrl) || 4)));
  const min = clamp01(minFailureRate, 0.008);
  const base = Math.max(min, clamp01(baseFailureRate, 0.15));

  return min + (base - min) * Math.exp(-FAILURE_DECAY * Math.max(0, trl - unlock));
}

function calculateXpGain({
  environmentWeight = 1.0,
  burnSeconds = 0,
  ratedSeconds = DEFAULT_RATED_BURN_SECONDS,
  outcome = 'SUCCESS',
}) {
  const weight = Number.isFinite(Number(environmentWeight))
    ? Math.max(0, Number(environmentWeight))
    : 1.0;
  const burn = Math.max(0, Number(burnSeconds) || 0);
  const rated = Number(ratedSeconds) > 0 ? Number(ratedSeconds) : DEFAULT_RATED_BURN_SECONDS;
  const outcomeMultiplier = outcome === 'SUCCESS' ? 1.0 : 1.5;

  return weight * (1 + burn / rated) * outcomeMultiplier;
}

function advanceTrl({
  currentTrl,
  trlXp,
  gainedXp,
  maxTrl = 9,
}) {
  let level = Math.max(0, Math.min(9, Math.floor(Number(currentTrl) || 0)));
  const cap = Math.max(level, Math.min(9, Math.floor(Number(maxTrl) || 9)));
  let xp = Math.max(0, Number(trlXp) || 0) + Math.max(0, Number(gainedXp) || 0);
  let levelsGained = 0;

  while (level < cap) {
    const required = xpRequired(level);
    if (xp < required) break;
    xp -= required;
    level += 1;
    levelsGained += 1;
  }

  return {
    current_trl: level,
    trl_xp: Number(xp.toFixed(3)),
    levels_gained: levelsGained,
    next_level_xp: level < cap ? xpRequired(level) : 0,
  };
}

function planStaticFire({ seed, multiplier, now = new Date() }) {
  const rng = createSeededRng(`static-fire:${seed}`);
  const durationGameDays = Math.round(
    STATIC_FIRE_MIN_GAME_DAYS
      + rng() * (STATIC_FIRE_MAX_GAME_DAYS - STATIC_FIRE_MIN_GAME_DAYS),
  );
  const burnSeconds = Math.round(90 + rng() * 90);
  const completedAt = new Date(
    now.getTime() + gameDaysToRealMs(durationGameDays, multiplier),
  ).toISOString();

  return {
    durationGameDays,
    burnSeconds,
    ratedSeconds: DEFAULT_RATED_BURN_SECONDS,
    completesAt: completedAt,
  };
}

async function findStaticFireLog(supabase, agencyId, eventId) {
  const { data, error } = await supabase
    .from('logs')
    .select('id, data')
    .eq('agency_id', agencyId)
    .eq('event_type', 'STATIC_FIRE_COMPLETE')
    .contains('data', { event_id: eventId })
    .maybeSingle();

  if (error) throw new Error(`STATIC_FIRE log lookup: ${error.message}`);
  return data || null;
}

async function handleStaticFire(supabase, event) {
  const agencyId = event?.agency_id || event?.payload?.agency_id;
  const nodeId = event?.reference_id || event?.payload?.node_id;

  if (!agencyId || !nodeId) {
    throw new Error('STATIC_FIRE is missing agency_id or node_id');
  }

  const existingLog = await findStaticFireLog(supabase, agencyId, event.id);
  if (existingLog) {
    return {
      node_id: nodeId,
      ...(existingLog.data || {}),
      already_completed: true,
    };
  }

  const [
    { data: tech, error: techError },
    { data: node, error: nodeError },
  ] = await Promise.all([
    supabase
      .from('technologies')
      .select('node_id, name, unlock_trl, max_trl, base_failure_rate, min_failure_rate')
      .eq('node_id', nodeId)
      .maybeSingle(),
    supabase
      .from('agency_tech_nodes')
      .select('*')
      .eq('agency_id', agencyId)
      .eq('node_id', nodeId)
      .maybeSingle(),
  ]);

  if (techError) throw new Error(`STATIC_FIRE technology: ${techError.message}`);
  if (nodeError) throw new Error(`STATIC_FIRE node: ${nodeError.message}`);
  if (!tech) throw new Error(`STATIC_FIRE technology not found: ${nodeId}`);
  if (!node) throw new Error(`STATIC_FIRE agency node not found: ${agencyId}/${nodeId}`);
  if (node.status !== 'UNLOCKED') {
    throw new Error(`STATIC_FIRE requires UNLOCKED node, found ${node.status}`);
  }

  const payload = event.payload || {};
  const rng = createSeededRng(hashSeed(`static-fire:${event.id}:${nodeId}`));
  const failChance = failureProbability({
    currentTrl: node.current_trl,
    unlockTrl: tech.unlock_trl,
    baseFailureRate: tech.base_failure_rate,
    minFailureRate: tech.min_failure_rate,
  });
  const failure = rng() < failChance;

  const burnSeconds = Number(payload.burn_seconds) || 120;
  const ratedSeconds = Number(payload.rated_seconds) || DEFAULT_RATED_BURN_SECONDS;
  const xpGain = calculateXpGain({
    environmentWeight: 1.0,
    burnSeconds,
    ratedSeconds,
    outcome: failure ? 'FAILURE_TELEMETRY' : 'SUCCESS',
  });
  const progression = advanceTrl({
    currentTrl: node.current_trl,
    trlXp: node.trl_xp,
    gainedXp: xpGain,
    maxTrl: tech.max_trl ?? 9,
  });

  const completedAt = eventTime(event);
  const { error: updateError } = await supabase
    .from('agency_tech_nodes')
    .update({
      current_trl: progression.current_trl,
      trl_xp: progression.trl_xp,
      total_activations: Number(node.total_activations || 0) + 1,
      failures_recorded: Number(node.failures_recorded || 0) + (failure ? 1 : 0),
    })
    .eq('agency_id', agencyId)
    .eq('node_id', nodeId)
    .eq('status', 'UNLOCKED');

  if (updateError) throw new Error(`STATIC_FIRE node update: ${updateError.message}`);

  const { error: logError } = await supabase
    .from('logs')
    .insert([{
      agency_id: agencyId,
      event_type: 'STATIC_FIRE_COMPLETE',
      description: `Static fire ${failure ? 'anomaly' : 'nominal'}: ${tech.name}`,
      data: {
        event_id: event.id,
        node_id: nodeId,
        technology: tech.name,
        outcome: failure ? 'FAILURE' : 'SUCCESS',
        failure_probability: Number(failChance.toFixed(4)),
        xp_gained: Number(xpGain.toFixed(3)),
        previous_trl: node.current_trl,
        current_trl: progression.current_trl,
        trl_xp: progression.trl_xp,
        levels_gained: progression.levels_gained,
        total_activations: Number(node.total_activations || 0) + 1,
        failures_recorded: Number(node.failures_recorded || 0) + (failure ? 1 : 0),
        burn_seconds: burnSeconds,
        rated_seconds: ratedSeconds,
        completed_at: completedAt,
      },
    }]);

  if (logError) throw new Error(`STATIC_FIRE log insert: ${logError.message}`);

  return {
    node_id: nodeId,
    technology: tech.name,
    outcome: failure ? 'FAILURE' : 'SUCCESS',
    failure_probability: Number(failChance.toFixed(4)),
    xp_gained: Number(xpGain.toFixed(3)),
    previous_trl: node.current_trl,
    current_trl: progression.current_trl,
    trl_xp: progression.trl_xp,
    levels_gained: progression.levels_gained,
    already_completed: false,
  };
}

function eventTime(event) {
  const date = event?.execute_at ? new Date(event.execute_at) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

module.exports = {
  XP_BASE,
  XP_GROWTH,
  FAILURE_DECAY,
  STATIC_FIRE_MIN_GAME_DAYS,
  STATIC_FIRE_MAX_GAME_DAYS,
  DEFAULT_RATED_BURN_SECONDS,
  xpRequired,
  failureProbability,
  calculateXpGain,
  advanceTrl,
  planStaticFire,
  handleStaticFire,
};
