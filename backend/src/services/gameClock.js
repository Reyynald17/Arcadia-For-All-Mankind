const MS_PER_DAY = 86400000;
const DEFAULT_TIME_SCALE = 52.142857;
const DEFAULT_EPOCH = '1969-07-20';

function toDate(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : fallback;
}

function normalizeSeason(season) {
  if (!season) throw new Error('Active season is required');

  const startRealTime = toDate(season.start_real_time);
  if (!startRealTime) throw new Error('Season start_real_time is invalid');

  const rawMultiplier = Number(season.time_scale_multiplier);
  const multiplier =
    Number.isFinite(rawMultiplier) && rawMultiplier > 0 ? rawMultiplier : DEFAULT_TIME_SCALE;

  return {
    startRealTime,
    epochGameDate: season.epoch_game_date || DEFAULT_EPOCH,
    multiplier,
  };
}

function realMsToGameDays(realMs, multiplier = DEFAULT_TIME_SCALE) {
  const scale = Number(multiplier);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('time_scale_multiplier must be positive');
  const ms = Number(realMs);
  if (!Number.isFinite(ms)) throw new Error('realMs must be finite');
  return (ms / MS_PER_DAY) * scale;
}

function gameDaysToRealMs(gameDays, multiplier = DEFAULT_TIME_SCALE) {
  const scale = Number(multiplier);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('time_scale_multiplier must be positive');
  const days = Number(gameDays);
  if (!Number.isFinite(days)) throw new Error('gameDays must be finite');
  return (days / scale) * MS_PER_DAY;
}

function gameDateAt(season, realDate = new Date()) {
  const normalized = normalizeSeason(season);
  const current = toDate(realDate);
  if (!current) throw new Error('realDate is invalid');

  const epoch = toDate(`${normalized.epochGameDate}T00:00:00.000Z`);
  if (!epoch) throw new Error('Season epoch_game_date is invalid');

  const elapsedGameDays = realMsToGameDays(
    current.getTime() - normalized.startRealTime.getTime(),
    normalized.multiplier,
  );

  return new Date(epoch.getTime() + elapsedGameDays * MS_PER_DAY);
}

function gameDateToRealDate(season, gameDate) {
  const normalized = normalizeSeason(season);
  const target = toDate(gameDate);
  if (!target) throw new Error('gameDate is invalid');

  const epoch = toDate(`${normalized.epochGameDate}T00:00:00.000Z`);
  if (!epoch) throw new Error('Season epoch_game_date is invalid');

  const gameDays = (target.getTime() - epoch.getTime()) / MS_PER_DAY;
  return new Date(
    normalized.startRealTime.getTime()
      + (gameDays / normalized.multiplier) * MS_PER_DAY,
  );
}

function formatGameDate(value) {
  const date = toDate(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

async function loadActiveSeason(supabase) {
  const { data, error } = await supabase
    .from('seasons')
    .select('id, name, start_real_time, epoch_game_date, time_scale_multiplier, status')
    .eq('status', 'ACTIVE')
    .order('start_real_time', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`active season: ${error.message}`);
  if (!data) throw new Error('No ACTIVE season found');
  return data;
}

module.exports = {
  MS_PER_DAY,
  DEFAULT_TIME_SCALE,
  DEFAULT_EPOCH,
  normalizeSeason,
  realMsToGameDays,
  gameDaysToRealMs,
  gameDateAt,
  gameDateToRealDate,
  formatGameDate,
  loadActiveSeason,
};
