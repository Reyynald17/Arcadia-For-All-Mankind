const express = require('express');
const {
  createAuthMiddleware,
  createAgencyOwnershipMiddleware,
} = require('../middleware/auth');
const { createRateLimitMiddleware } = require('../middleware/rateLimit');
const { MissionScheduleError, scheduleMission } = require('../services/missionScheduler');
const { evaluateMissionFeasibility } = require('../services/missionFeasibility');
const { loadAgencyCrew } = require('../services/crewEngine');
const { MISSION_TYPES } = require('../services/economyEngine');
const {
  MissionQueueError,
  listMissionQueue,
  enqueueMission,
  promoteNextMission,
  cancelQueueItem,
} = require('../services/missionQueue');

function errorStatus(error) {
  if (error instanceof MissionScheduleError || error instanceof MissionQueueError) {
    return error.status;
  }
  return 500;
}

function migrationMissing(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes('does not exist') ||
    message.includes('Could not find the table')
  );
}

function sendError(res, error) {
  if (migrationMissing(error)) {
    return res.status(503).json({
      error: 'ECONOMY_MIGRATION_REQUIRED',
      message: 'Apply migrations 008_economy.sql and 009_economy_rls.sql first.',
    });
  }
  const status = errorStatus(error);
  const message = error?.message || 'Launch operation failed';
  if (status >= 500) {
    return res.status(status).json({ error: message });
  }
  const payload = { error: message, message };
  if (error?.details) payload.details = error.details;
  return res.status(status).json(payload);
}

module.exports = (supabase, deps = {}) => {
  const router = express.Router();
  const authenticate = deps.authenticate || createAuthMiddleware(supabase);
  const requireOwnedAgency = deps.requireOwnedAgency || createAgencyOwnershipMiddleware(supabase);
  const writeRateLimit = deps.writeRateLimit
    || createRateLimitMiddleware({ windowMs: 60000, max: 30 });

  router.use(authenticate);

  // Schedule a mission immediately. Rollout and ignition are completed by the event worker.
  router.post('/mission', writeRateLimit, requireOwnedAgency, async (req, res) => {
    const body = req.body || {};
    try {
      const result = await scheduleMission({
        supabase,
        agencyId: body.agencyId,
        missionName: body.missionName,
        vehicleId: body.vehicleId,
        missionType: body.missionType,
        targetInclinationDeg: body.targetInclinationDeg,
        azimuthDeg: body.azimuthDeg,
        contractKey: body.contractKey,
        source: 'direct',
      });
      res.status(202).json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  // Preview the delta-v, payload, crew, and funding envelope before scheduling.
  router.get('/feasibility/:agencyId', requireOwnedAgency, async (req, res) => {
    const { agencyId } = req.params;
    const { vehicleId, missionType, targetInclinationDeg } = req.query;

    if (!vehicleId || !missionType) {
      return res.status(400).json({
        error: 'vehicleId and missionType are required',
        message: 'vehicleId and missionType are required',
      });
    }
    if (!MISSION_TYPES.has(missionType)) {
      return res.status(400).json({
        error: `Unknown mission type: ${missionType}`,
        message: `Unknown mission type: ${missionType}`,
      });
    }

    try {
      const [
        { data: agency, error: agencyError },
        { data: vehicle, error: vehicleError },
        crewPool,
      ] = await Promise.all([
        supabase.from('agencies').select('*').eq('id', agencyId).single(),
        supabase.from('vehicles').select('*').eq('id', vehicleId).single(),
        loadAgencyCrew(supabase, agencyId),
      ]);

      if (agencyError || !agency) {
        return res.status(404).json({ error: 'Agency not found', message: 'Agency not found' });
      }
      if (vehicleError || !vehicle) {
        return res.status(404).json({ error: 'Vehicle not found', message: 'Vehicle not found' });
      }
      if (vehicle.agency_id !== agencyId) {
        return res.status(403).json({
          error: 'Vehicle does not belong to this agency',
          message: 'Vehicle does not belong to this agency',
        });
      }

      const activeCrew = (crewPool.rows || []).filter(
        (crew) => String(crew.status || '').toUpperCase() === 'ACTIVE',
      );
      const feasibility = evaluateMissionFeasibility({
        agency,
        vehicle,
        missionType,
        targetInclinationDeg,
        crewAvailable: crewPool.migration_required ? null : activeCrew.length,
      });
      res.json({ feasibility });
    } catch (error) {
      sendError(res, error);
    }
  });

  // Queue a mission. The next item starts automatically when the pad is clear.
  router.post('/queue', writeRateLimit, requireOwnedAgency, async (req, res) => {
    const body = req.body || {};
    try {
      const result = await enqueueMission({
        supabase,
        agencyId: body.agencyId,
        missionName: body.missionName,
        vehicleId: body.vehicleId,
        missionType: body.missionType,
        targetInclinationDeg: body.targetInclinationDeg,
        azimuthDeg: body.azimuthDeg,
        contractKey: body.contractKey,
      });
      res.status(202).json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/queue/:agencyId', requireOwnedAgency, async (req, res) => {
    try {
      const result = await listMissionQueue(supabase, req.params.agencyId);
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/queue/:queueId/cancel', writeRateLimit, requireOwnedAgency, async (req, res) => {
    const { agencyId } = req.body || {};
    if (!agencyId) return res.status(400).json({ error: 'Missing agencyId' });

    try {
      const queueItem = await cancelQueueItem(supabase, agencyId, req.params.queueId);
      const promotion = await promoteNextMission(supabase, agencyId);
      res.json({ queueItem, promotion });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/queue/:agencyId/dispatch', writeRateLimit, requireOwnedAgency, async (req, res) => {
    try {
      const promotion = await promoteNextMission(supabase, req.params.agencyId);
      res.json({ promotion });
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
};
