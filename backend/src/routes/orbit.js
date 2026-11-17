const express = require('express');
const { loadActiveSeason } = require('../services/gameClock');
const { buildOrbitOverview } = require('../services/orbitalEngine');

const TRACKED_MISSION_STATUSES = ['ROLLOUT', 'COUNTDOWN', 'ASCENT', 'ORBIT'];

module.exports = (supabase) => {
  const router = express.Router();

  router.get('/overview/:agencyId', async (req, res) => {
    try {
      const { agencyId } = req.params;

      const [{ data: agency, error: agencyError }, season, { data: stations, error: stationError }] =
        await Promise.all([
          supabase.from('agencies').select('*').eq('id', agencyId).single(),
          loadActiveSeason(supabase),
          supabase.from('ground_stations').select('*').eq('active', true),
        ]);

      if (agencyError || !agency) {
        return res.status(404).json({ error: 'Agency not found' });
      }
      if (stationError) throw new Error(`ground stations: ${stationError.message}`);

      const { data: missions, error: missionError } = await supabase
        .from('missions')
        .select('*')
        .eq('agency_id', agencyId)
        .in('status', TRACKED_MISSION_STATUSES)
        .order('scheduled_launch_at', { ascending: false, nullsFirst: false })
        .limit(8);

      if (missionError) throw new Error(`missions: ${missionError.message}`);

      const overview = buildOrbitOverview({
        agency,
        missions: missions || [],
        stations: stations || [],
        multiplier: season.time_scale_multiplier,
        now: new Date(),
      });

      res.json(overview);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
