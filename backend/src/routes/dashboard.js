const express = require('express');
const router = express.Router();

module.exports = (supabase) => {
  // Get dashboard data for agency
  router.get('/:agencyId', async (req, res) => {
    try {
      const { agencyId } = req.params;

      // Get agency
      const { data: agency, error: agencyError } = await supabase
        .from('agencies')
        .select('*')
        .eq('id', agencyId)
        .single();

      if (agencyError || !agency) {
        return res.status(404).json({ error: 'Agency not found' });
      }

      // Get recent logs
      const { data: logs, error: logsError } = await supabase
        .from('logs')
        .select('*')
        .eq('agency_id', agencyId)
        .order('created_at', { ascending: false })
        .limit(10);

      // Get vehicles
      const { data: vehicles, error: vehiclesError } = await supabase
        .from('vehicles')
        .select('*')
        .eq('agency_id', agencyId);

      // Get recent missions
      const { data: missions, error: missionsError } = await supabase
        .from('missions')
        .select('*')
        .eq('agency_id', agencyId)
        .order('launched_at', { ascending: false })
        .limit(5);

      // Get ranking
      const { data: ranking, error: rankingError } = await supabase
        .from('agencies')
        .select('id, name, rp')
        .order('rp', { ascending: false });

      const agencyRank = ranking.findIndex(a => a.id === agencyId) + 1;

      res.json({
        agency,
        agencyRank,
        logs: logs || [],
        vehicles: vehicles || [],
        missions: missions || [],
        gameDate: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get ranking
  router.get('/ranking/global', async (req, res) => {
    try {
      const { data: ranking, error } = await supabase
        .from('agencies')
        .select('id, name, country, rp, si, ipi, slr, total_launches, successful_launches')
        .order('rp', { ascending: false })
        .limit(50);

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      const withRank = ranking.map((agency, index) => ({
        ...agency,
        rank: index + 1
      }));

      res.json(withRank);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};