const express = require('express');
const router = express.Router();
const AGMEngine = require('../services/agm');

module.exports = (supabase) => {
  // Start research
  router.post('/start', async (req, res) => {
    try {
      const { agencyId, technologyName } = req.body;

      if (!agencyId || !technologyName) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Get agency
      const { data: agency, error: agencyError } = await supabase
        .from('agencies')
        .select('*')
        .eq('id', agencyId)
        .single();

      if (agencyError || !agency) {
        return res.status(404).json({ error: 'Agency not found' });
      }

      // Get technology
      const { data: tech, error: techError } = await supabase
        .from('technologies')
        .select('*')
        .eq('name', technologyName)
        .single();

      if (techError || !tech) {
        return res.status(404).json({ error: 'Technology not found' });
      }

      // Validate research with AGM
      const validation = AGMEngine.validateResearch(agency, tech);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.message });
      }

      // Deduct AP and Budget
      const newAp = agency.ap - tech.research_cost_ap;
      const newBudget = agency.budget - tech.research_cost_budget;

      // Update agency
      await supabase
        .from('agencies')
        .update({ ap: newAp, budget: newBudget })
        .eq('id', agencyId);

      // Create research log
      const { data: log } = await supabase
        .from('logs')
        .insert([
          {
            agency_id: agencyId,
            event_type: 'RESEARCH_STARTED',
            description: `Research started: ${technologyName}`,
            data: {
              technology: technologyName,
              cost_ap: tech.research_cost_ap,
              cost_budget: tech.research_cost_budget,
              duration_days: tech.duration_days
            }
          }
        ])
        .select();

      res.status(201).json({
        message: 'Research started',
        newAp,
        newBudget,
        technology: technologyName,
        durationDays: tech.duration_days
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get available technologies
  router.get('/available/:agencyId', async (req, res) => {
    try {
      const { agencyId } = req.params;

      const { data: technologies, error } = await supabase
        .from('technologies')
        .select('*')
        .order('era', { ascending: true });

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      res.json(technologies);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};