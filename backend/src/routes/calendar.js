const express = require('express');
const {
  gameDateAt,
  gameDateToRealDate,
  loadActiveSeason,
} = require('../services/gameClock');

const MS_PER_DAY = 86400000;

module.exports = (supabase, { now = () => new Date() } = {}) => {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const season = await loadActiveSeason(supabase);
      const realNow = now();
      const gameNow = gameDateAt(season, realNow);
      const multiplier = Number(season.time_scale_multiplier) || 52.142857;

      const acdYear = gameNow.getUTCFullYear();
      const yearStart = new Date(Date.UTC(acdYear, 0, 1));
      const yearEnd = new Date(Date.UTC(acdYear + 1, 0, 1));
      const yearStartReal = gameDateToRealDate(season, yearStart);
      const yearEndReal = gameDateToRealDate(season, yearEnd);
      const yearSpanMs = yearEndReal.getTime() - yearStartReal.getTime();
      const yearProgress = yearSpanMs > 0
        ? Math.min(1, Math.max(0, (realNow.getTime() - yearStartReal.getTime()) / yearSpanMs))
        : 0;

      res.json({
        realNow: realNow.toISOString(),
        gameNow: gameNow.toISOString(),
        gameDate: gameNow.toISOString().slice(0, 10),
        season: {
          id: season.id,
          name: season.name,
          start_real_time: season.start_real_time,
          epoch_game_date: season.epoch_game_date,
          time_scale_multiplier: multiplier,
          status: season.status,
        },
        conversion: {
          gameDaysPerRealDay: multiplier,
          gameDaysPerRealWeek: multiplier * 7,
          realDaysPerGameYear: 365 / multiplier,
          realWeekEqualsAcdYears: (multiplier * 7) / 365,
          acdYear,
          acdYearStartRealAt: yearStartReal.toISOString(),
          acdYearEndRealAt: yearEndReal.toISOString(),
          acdYearProgress: yearProgress,
          acdYearRealDays: yearSpanMs / MS_PER_DAY,
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
