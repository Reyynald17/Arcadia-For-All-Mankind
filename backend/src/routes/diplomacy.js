const express = require('express');
const { createAuthMiddleware } = require('../middleware/auth');
const { createRateLimitMiddleware } = require('../middleware/rateLimit');
const {
  DiplomacyError,
  createProposal,
  previewProposal,
  respondToProposal,
  withdrawProposal,
  terminateAgreement,
  listDirectory,
  listRelations,
  getRelationDetail,
  listProposals,
  listAgreements,
  getDiplomacyOverview,
  loadAgency,
  getPublicPolicy,
  DIPLOMACY_CONFIG,
} = require('../services/diplomacyEngine');

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function sendError(res, error) {
  if (error instanceof DiplomacyError) {
    return res.status(error.status).json({
      error: error.code,
      message: error.message,
      details: error.details || {},
    });
  }
  console.error(`[diplomacy] ${error?.message || 'unknown error'}`);
  return res.status(500).json({
    error: 'DIPLOMACY_FAILED',
    message: 'Diplomacy request failed.',
    details: {},
  });
}

async function loadOwnedAgency(supabase, req, agencyId) {
  if (!agencyId) {
    throw new DiplomacyError('AGENCY_NOT_FOUND', 'Agency is required.');
  }
  const agency = await loadAgency(supabase, agencyId);
  if (!agency) {
    throw new DiplomacyError('AGENCY_NOT_FOUND', 'Agency not found.');
  }
  if (
    agency.controller_type !== 'player'
    || String(agency.user_id || '') !== String(req.authUser.id)
  ) {
    throw new DiplomacyError('FORBIDDEN_AGENCY', 'You do not control this agency.');
  }
  return agency;
}

function createRateLimiter(config = DIPLOMACY_CONFIG) {
  const hits = new Map();
  return function check(key, nowMs = Date.now()) {
    const windowMs = Number(config.limits.rateLimitWindowMs);
    const max = Number(config.limits.rateLimitMaxProposals);
    const cutoff = nowMs - windowMs;
    const recent = (hits.get(key) || []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= max) {
      const retryAfterMs = Math.max(0, recent[0] + windowMs - nowMs);
      hits.set(key, recent);
      return { allowed: false, retryAfterMs };
    }
    recent.push(nowMs);
    hits.set(key, recent);
    return { allowed: true, retryAfterMs: 0 };
  };
}

module.exports = (supabase, deps = {}) => {
  const router = express.Router();
  const authenticate = deps.authenticate || createAuthMiddleware(supabase);
  const rateLimit = deps.rateLimit || createRateLimiter();
  const writeRateLimit = deps.writeRateLimit
    || createRateLimitMiddleware({ windowMs: 60000, max: 30 });
  const clock = deps.now || (() => new Date());

  router.use(authenticate);

  router.get('/config', asyncRoute(async (req, res) => {
    res.json(getPublicPolicy(deps.config || DIPLOMACY_CONFIG));
  }));

  router.get('/agencies', asyncRoute(async (req, res) => {
    const directory = await listDirectory(supabase, {
      bloc: req.query.bloc || 'all',
      status: req.query.status || 'active',
      search: req.query.search || '',
    });
    res.json(directory);
  }));

  router.get('/overview/:agencyId', asyncRoute(async (req, res) => {
    const agency = await loadOwnedAgency(supabase, req, req.params.agencyId);
    const overview = await getDiplomacyOverview(supabase, {
      agencyId: agency.id,
      agency,
      config: deps.config || DIPLOMACY_CONFIG,
      now: clock(),
    });
    res.json(overview);
  }));

  router.get('/relations/:agencyId/:counterpartId', asyncRoute(async (req, res) => {
    const agency = await loadOwnedAgency(supabase, req, req.params.agencyId);
    const detail = await getRelationDetail(supabase, {
      agencyId: agency.id,
      counterpartId: req.params.counterpartId,
      config: deps.config || DIPLOMACY_CONFIG,
      now: clock(),
    });
    res.json(detail);
  }));

  router.get('/relations/:agencyId', asyncRoute(async (req, res) => {
    const agency = await loadOwnedAgency(supabase, req, req.params.agencyId);
    const relations = await listRelations(supabase, {
      agencyId: agency.id,
      config: deps.config || DIPLOMACY_CONFIG,
      now: clock(),
    });
    res.json({ relations });
  }));

  router.get('/proposals/:agencyId', asyncRoute(async (req, res) => {
    const agency = await loadOwnedAgency(supabase, req, req.params.agencyId);
    const proposals = await listProposals(supabase, {
      agencyId: agency.id,
      box: req.query.box || 'all',
      config: deps.config || DIPLOMACY_CONFIG,
      now: clock(),
    });
    res.json({
      ...proposals,
      counts: {
        incoming: proposals.incoming.length,
        outgoing: proposals.outgoing.length,
        pendingIncoming: proposals.incoming.filter((item) => item.can_respond).length,
        pendingOutgoing: proposals.outgoing.filter((item) => item.status === 'pending').length,
      },
    });
  }));

  router.post('/proposals/preview', asyncRoute(async (req, res) => {
    const body = req.body || {};
    const agency = await loadOwnedAgency(supabase, req, body.agencyId);
    const preview = await previewProposal(supabase, {
      fromAgencyId: agency.id,
      targetAgencyId: body.targetAgencyId,
      agreementType: body.agreementType || 'cooperation',
      durationDays: Number(body.durationDays),
      note: body.note,
      config: deps.config || DIPLOMACY_CONFIG,
      now: clock(),
    });
    res.json(preview);
  }));

  router.post('/proposals', writeRateLimit, asyncRoute(async (req, res) => {
    const body = req.body || {};
    const agency = await loadOwnedAgency(supabase, req, body.agencyId);
    const limit = rateLimit(`${req.authUser.id}:${agency.id}`, Date.now());
    if (!limit.allowed) {
      throw new DiplomacyError('RATE_LIMITED', 'Too many proposals created recently.', {
        retryAfterMs: limit.retryAfterMs,
      });
    }

    const result = await createProposal(supabase, {
      fromAgencyId: agency.id,
      targetAgencyId: body.targetAgencyId,
      agreementType: body.agreementType || 'cooperation',
      durationDays: Number(body.durationDays),
      note: body.note,
      config: deps.config || DIPLOMACY_CONFIG,
      now: clock(),
    });
    res.status(201).json(result);
  }));

  router.post('/proposals/:id/respond', writeRateLimit, asyncRoute(async (req, res) => {
    const body = req.body || {};
    const agency = await loadOwnedAgency(supabase, req, body.agencyId);
    const result = await respondToProposal(supabase, {
      proposalId: req.params.id,
      actorAgencyId: agency.id,
      action: body.action,
      reason: body.reason,
      note: body.note,
      config: deps.config || DIPLOMACY_CONFIG,
      now: clock(),
    });
    res.json(result);
  }));

  router.post('/proposals/:id/withdraw', writeRateLimit, asyncRoute(async (req, res) => {
    const body = req.body || {};
    const agency = await loadOwnedAgency(supabase, req, body.agencyId);
    const result = await withdrawProposal(supabase, {
      proposalId: req.params.id,
      actorAgencyId: agency.id,
      now: clock(),
    });
    res.json(result);
  }));

  router.get('/agreements/:agencyId', asyncRoute(async (req, res) => {
    const agency = await loadOwnedAgency(supabase, req, req.params.agencyId);
    const agreements = await listAgreements(supabase, { agencyId: agency.id });
    res.json(agreements);
  }));

  router.post('/agreements/:id/terminate', writeRateLimit, asyncRoute(async (req, res) => {
    const body = req.body || {};
    const agency = await loadOwnedAgency(supabase, req, body.agencyId);
    const result = await terminateAgreement(supabase, {
      agreementId: req.params.id,
      actorAgencyId: agency.id,
      config: deps.config || DIPLOMACY_CONFIG,
      now: clock(),
    });
    res.json(result);
  }));

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    return sendError(res, error);
  });

  return router;
};
