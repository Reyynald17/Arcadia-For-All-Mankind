const express = require('express');
const {
  createAuthMiddleware,
  createAgencyOwnershipMiddleware,
} = require('../middleware/auth');
const { createRateLimitMiddleware } = require('../middleware/rateLimit');
const {
  CrewError,
  getCrewOverview,
  recruitCrew,
} = require('../services/crewEngine');
const {
  InvestigationError,
  listInvestigations,
  startInvestigation,
} = require('../services/investigationEngine');
const { playerActor } = require('../services/auditLog');

function sendError(res, error) {
  if (error instanceof CrewError || error instanceof InvestigationError) {
    return res.status(error.status).json({
      error: error.details?.code || error.name.toUpperCase(),
      message: error.message,
      details: error.details || undefined,
    });
  }
  const message = error?.message || 'Personnel operation failed';
  return res.status(500).json({ error: 'PERSONNEL_ERROR', message });
}

module.exports = (supabase, deps = {}) => {
  const router = express.Router();
  const authenticate = deps.authenticate || createAuthMiddleware(supabase);
  const requireOwnedAgency = deps.requireOwnedAgency || createAgencyOwnershipMiddleware(supabase);
  const writeRateLimit = deps.writeRateLimit
    || createRateLimitMiddleware({ windowMs: 60000, max: 30 });

  router.use(authenticate);

  router.get('/:agencyId', requireOwnedAgency, async (req, res) => {
    const { agencyId } = req.params;
    try {
      const [overview, investigations] = await Promise.all([
        getCrewOverview(supabase, agencyId),
        listInvestigations(supabase, agencyId),
      ]);

      res.json({
        ...overview,
        investigations: investigations.items,
        investigations_migration_required: investigations.migration_required,
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/recruit', writeRateLimit, requireOwnedAgency, async (req, res) => {
    const { agencyId, name, role } = req.body || {};
    try {
      const { data: agency, error: agencyError } = await supabase
        .from('agencies')
        .select('*')
        .eq('id', agencyId)
        .single();
      if (agencyError || !agency) {
        return res.status(404).json({ error: 'AGENCY_NOT_FOUND', message: 'Agency not found' });
      }

      const result = await recruitCrew(supabase, {
        agency,
        name,
        role,
        actor: playerActor(req),
      });
      res.status(201).json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/investigations/start', writeRateLimit, requireOwnedAgency, async (req, res) => {
    const { agencyId, missionId } = req.body || {};
    try {
      const { data: agency, error: agencyError } = await supabase
        .from('agencies')
        .select('*')
        .eq('id', agencyId)
        .single();
      if (agencyError || !agency) {
        return res.status(404).json({ error: 'AGENCY_NOT_FOUND', message: 'Agency not found' });
      }

      const result = await startInvestigation(supabase, {
        agency,
        missionId,
        actor: playerActor(req),
      });
      res.status(202).json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
};
