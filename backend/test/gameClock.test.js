const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MS_PER_DAY,
  realMsToGameDays,
  gameDaysToRealMs,
  gameDateAt,
  formatGameDate,
  normalizeSeason,
} = require('../src/services/gameClock');

const season = {
  start_real_time: '2026-11-16T00:00:00.000Z',
  epoch_game_date: '1969-07-20',
  time_scale_multiplier: 52.142857,
};

test('one real week advances approximately one game year', () => {
  const gameDate = gameDateAt(season, new Date('2026-11-23T12:00:00.000Z'));
  assert.equal(formatGameDate(gameDate), '1970-08-15');
  assert.ok(
    Math.abs(realMsToGameDays(7 * MS_PER_DAY, season.time_scale_multiplier) - 365) < 0.001,
  );
});

test('game-day and real-time conversion round trips', () => {
  assert.ok(
    Math.abs(gameDaysToRealMs(365, season.time_scale_multiplier) - 7 * MS_PER_DAY) < 10,
  );
  assert.ok(
    Math.abs(realMsToGameDays(7 * MS_PER_DAY, season.time_scale_multiplier) - 365) < 0.001,
  );
});

test('normalizeSeason applies the documented defaults', () => {
  const normalized = normalizeSeason({ start_real_time: season.start_real_time });
  assert.equal(normalized.epochGameDate, '1969-07-20');
  assert.equal(normalized.multiplier, 52.142857);
});

test('invalid time scale is rejected', () => {
  assert.throws(() => gameDaysToRealMs(1, 0), /time_scale_multiplier/);
  assert.throws(() => realMsToGameDays(1, -1), /time_scale_multiplier/);
});
