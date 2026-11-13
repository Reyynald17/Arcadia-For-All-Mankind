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

      // Enforce tech-tree rules using the agency research audit trail
      const { data: researchLogs } = await supabase
        .from('logs')
        .select('event_type, description, data')
        .eq('agency_id', agencyId)
        .like('event_type', 'RESEARCH%');

      const startedTechs = new Set();
      const completedTechs = new Set();

      for (const log of researchLogs || []) {
        const loggedName =
          log?.data?.technology ||
          String(log.description || '').replace(/^Research (?:started|completed):\s*/i, '').trim();
        if (!loggedName) continue;

        const key = loggedName.toLowerCase();
        startedTechs.add(key);
        if (String(log.event_type || '').includes('COMPLETED')) {
          completedTechs.add(key);
        }
      }

      if (startedTechs.has(tech.name.toLowerCase())) {
        return res.status(400).json({ error: 'Research already started for this technology' });
      }

      const prerequisites = Array.isArray(tech.prerequisite) ? tech.prerequisite : [];
      const missingPrerequisite = prerequisites.find(
        (name) => !completedTechs.has(String(name).toLowerCase())
      );

      if (missingPrerequisite) {
        return res.status(400).json({ error: `Prerequisite not completed: ${missingPrerequisite}` });
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

      const [techResult, logResult] = await Promise.all([
        supabase.from('technologies').select('*').order('era', { ascending: true }),
        supabase
          .from('logs')
          .select('event_type, description, data, created_at')
          .eq('agency_id', agencyId)
          .like('event_type', 'RESEARCH%')
          .order('created_at', { ascending: false }),
      ]);

      if (techResult.error) {
        return res.status(400).json({ error: techResult.error.message });
      }

      res.json({
        technologies: techResult.data || [],
        researchLogs: logResult.error ? [] : logResult.data || [],
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};