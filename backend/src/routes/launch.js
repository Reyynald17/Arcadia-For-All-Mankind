const express = require('express');
const { MissionScheduleError, scheduleMission } = require('../services/missionScheduler');
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
  return res.status(status).json({ error: message, message });
}

module.exports = (supabase) => {
  const router = express.Router();

  // Schedule a mission immediately. Rollout and ignition are completed by the event worker.
  router.post('/mission', async (req, res) => {
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

  // Queue a mission. The next item starts automatically when the pad is clear.
  router.post('/queue', async (req, res) => {
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

  router.get('/queue/:agencyId', async (req, res) => {
    try {
      const result = await listMissionQueue(supabase, req.params.agencyId);
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/queue/:queueId/cancel', async (req, res) => {
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

  router.post('/queue/:agencyId/dispatch', async (req, res) => {
    try {
      const promotion = await promoteNextMission(supabase, req.params.agencyId);
      res.json({ promotion });
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
};
