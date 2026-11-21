const { gameDaysToRealMs } = require('./gameClock');
const { createSeededRng } = require('./seededRng');

const ROLLOUT_MIN_GAME_DAYS = 45;
const ROLLOUT_MAX_GAME_DAYS = 60;
const COUNTDOWN_GAME_DAYS = 1;
const ACTIVE_MISSION_STATUSES = ['PLANNED', 'ROLLOUT', 'COUNTDOWN', 'ASCENT'];

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

module.exports = {
  ROLLOUT_MIN_GAME_DAYS,
  ROLLOUT_MAX_GAME_DAYS,
  COUNTDOWN_GAME_DAYS,
  ACTIVE_MISSION_STATUSES,
  planLaunchSchedule,
};
