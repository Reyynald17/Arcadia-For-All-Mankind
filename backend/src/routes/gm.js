const express = require('express');
const { createGmAuthMiddleware } = require('../middleware/gm');
const { createRateLimitMiddleware } = require('../middleware/rateLimit');
const {
  gameDateAt,
  gameDaysToRealMs,
  loadActiveSeason,
} = require('../services/gameClock');
const { recordAuditEvent, listAuditEvents, gmActor } = require('../services/auditLog');
const { MAX_RELIABILITY } = require('../services/investigationEngine');

const OPERATION_EVENT_TYPES = [
  'PRODUCTION_COMPLETE',
  'ROLLOUT_COMPLETE',
  'LAUNCH_IGNITION',
  'ORBIT_OPERATIONS_COMPLETE',
  'TECH_COMPLETE',
  'STATIC_FIRE',
  'CREW_TRAINING_COMPLETE',
  'INVESTIGATION_COMPLETE',
];

const OPERATION_EVENT_SET = new Set(OPERATION_EVENT_TYPES);
const MAX_ADVANCE_GAME_DAYS = 3650;
const DEFAULT_REPAIR_BONUS = 5;
const MAX_REPAIR_BONUS = 20;

function parseInteger(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

function eventTime(event) {
  const value = new Date(event.execute_at).getTime();
  return Number.isFinite(value) ? value : 0;
}

module.exports = (
  supabase,
  {
    accessKey = process.env.GM_ACCESS_KEY,
    now = () => new Date(),
    writeRateLimit = createRateLimitMiddleware({ windowMs: 60000, max: 30 }),
  } = {},
) => {
  const router = express.Router();

  router.use(createGmAuthMiddleware({ accessKey }));

  router.get('/agencies', async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('agencies')
        .select('id, name, country, alignment, science_points, funding_usd, rp, total_launches, successful_launches, season_id')
        .order('name', { ascending: true });

      if (error) throw new Error(error.message);
      res.json({ agencies: data || [] });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/audit', async (req, res) => {
    try {
      const events = await listAuditEvents(supabase, {
        agencyId: String(req.query.agencyId || '').trim() || undefined,
        actorType: String(req.query.actorType || '').trim() || undefined,
        action: String(req.query.action || '').trim() || undefined,
        entityType: String(req.query.entityType || '').trim() || undefined,
        limit: req.query.limit,
        before: String(req.query.before || '').trim() || undefined,
      });
      res.json({ events });
    } catch (error) {
      const status = error.status === 503 ? 503 : 500;
      res.status(status).json({
        error: error.code || 'AUDIT_QUERY_FAILED',
        message: error.message,
      });
    }
  });

  router.get('/state', async (req, res) => {
    const agencyId = String(req.query.agencyId || '').trim();
    if (!agencyId) {
      return res.status(400).json({ error: 'agencyId is required' });
    }

    try {
      const season = await loadActiveSeason(supabase);
      const { data: agency, error: agencyError } = await supabase
        .from('agencies')
        .select('*')
        .eq('id', agencyId)
        .single();

      if (agencyError || !agency) {
        return res.status(404).json({ error: 'Agency not found' });
      }

      const [
        { data: vehicles, error: vehicleError },
        { data: missions, error: missionError },
        { data: events, error: eventError },
      ] = await Promise.all([
        supabase
          .from('vehicles')
          .select('*')
          .eq('agency_id', agencyId),
        supabase
          .from('missions')
          .select('*')
          .eq('agency_id', agencyId)
          .order('scheduled_launch_at', { ascending: false, nullsFirst: false })
          .limit(10),
        supabase
          .from('scheduled_events')
          .select('*')
          .eq('agency_id', agencyId)
          .eq('status', 'PENDING')
          .order('execute_at', { ascending: true })
          .limit(50),
      ]);

      if (vehicleError) throw new Error(`vehicles: ${vehicleError.message}`);
      if (missionError) throw new Error(`missions: ${missionError.message}`);
      if (eventError) throw new Error(`scheduled events: ${eventError.message}`);

      const realNow = now();
      const gameNow = gameDateAt(season, realNow);
      const pendingEvents = [...(events || [])].sort(
        (a, b) => eventTime(a) - eventTime(b),
      );

      res.json({
        agency,
        season,
        realNow: realNow.toISOString(),
        gameDate: gameNow.toISOString(),
        timeScale: Number(season.time_scale_multiplier) || 52.142857,
        vehicles: vehicles || [],
        missions: missions || [],
        events: pendingEvents,
        operationEventTypes: OPERATION_EVENT_TYPES,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/advance', writeRateLimit, async (req, res) => {
    const body = req.body || {};
    const agencyId = String(body.agencyId || '').trim();
    const mode = body.mode === 'now' ? 'now' : 'shift';
    const scope = body.scope === 'all' ? 'all' : 'operations';

    if (!agencyId) {
      return res.status(400).json({ error: 'agencyId is required' });
    }

    let gameDays = null;
    if (mode === 'shift') {
      gameDays = Number(body.gameDays);
      if (!Number.isFinite(gameDays) || gameDays <= 0) {
        return res.status(400).json({ error: 'gameDays must be a positive number' });
      }
      if (gameDays > MAX_ADVANCE_GAME_DAYS) {
        return res.status(400).json({
          error: `gameDays cannot exceed ${MAX_ADVANCE_GAME_DAYS}`,
        });
      }
    }

    try {
      const { data: agency, error: agencyError } = await supabase
        .from('agencies')
        .select('id, name')
        .eq('id', agencyId)
        .single();

      if (agencyError || !agency) {
        return res.status(404).json({ error: 'Agency not found' });
      }

      const season = await loadActiveSeason(supabase);
      const multiplier = Number(season.time_scale_multiplier) || 52.142857;

      const { data: events, error: eventError } = await supabase
        .from('scheduled_events')
        .select('*')
        .eq('agency_id', agencyId)
        .eq('status', 'PENDING')
        .order('execute_at', { ascending: true })
        .limit(100);

      if (eventError) throw new Error(`scheduled events: ${eventError.message}`);

      const inScope = [...(events || [])]
        .filter((event) => scope === 'all' || OPERATION_EVENT_SET.has(event.event_type))
        .sort((a, b) => eventTime(a) - eventTime(b));

      if (inScope.length === 0) {
        return res.json({
          agency,
          updated: 0,
          skipped: 0,
          mode,
          scope,
          gameDays,
        });
      }

      const nowMs = now().getTime();
      const shiftMs = mode === 'now' ? null : gameDaysToRealMs(gameDays, multiplier);
      const planned = inScope.map((event) => {
        const originalMs = eventTime(event);
        const targetMs = shiftMs === null ? nowMs : originalMs - shiftMs;
        return { event, originalMs, targetMs };
      });

      const overdueCount = planned.filter((item) => item.targetMs <= nowMs).length;
      const overdueBase = nowMs - overdueCount * 1000;
      let overdueIndex = 0;

      const updates = planned.map((item) => {
        let targetMs = item.targetMs;
        if (targetMs <= nowMs) {
          targetMs = overdueBase + overdueIndex * 1000;
          overdueIndex += 1;
        }
        return {
          id: item.event.id,
          event_type: item.event.event_type,
          reference_id: item.event.reference_id,
          execute_at: new Date(targetMs).toISOString(),
        };
      });

      const results = await Promise.all(updates.map(async (update) => {
        const { data, error } = await supabase
          .from('scheduled_events')
          .update({ execute_at: update.execute_at })
          .eq('id', update.id)
          .eq('status', 'PENDING')
          .select('id')
          .maybeSingle();

        if (error) throw new Error(`event ${update.id}: ${error.message}`);
        return data ? update : null;
      }));

      const applied = results.filter(Boolean);

      await recordAuditEvent(supabase, {
        ...gmActor(req),
        seasonId: season.id,
        agencyId,
        action: 'GM_ADVANCE_TIME',
        entityType: 'agency',
        entityId: agencyId,
        deltaData: { events_shifted: applied.length },
        metadata: {
          mode,
          scope,
          gameDays,
          updated: applied.length,
          skipped: updates.length - applied.length,
          realMinutes: shiftMs === null ? null : Math.round(shiftMs / 60000),
          eventIds: applied.map((event) => event.id),
          ip: req.ip || null,
        },
      });

      res.json({
        agency,
        updated: applied.length,
        skipped: updates.length - applied.length,
        mode,
        scope,
        gameDays,
        realMinutes: shiftMs === null ? null : Math.round(shiftMs / 60000),
        events: applied,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  const VEHICLE_COLUMNS = 'id, agency_id, name, type, status, reliability';

  async function findVehicle(vehicleId) {
    const { data, error } = await supabase
      .from('vehicles')
      .select(VEHICLE_COLUMNS)
      .eq('id', vehicleId)
      .maybeSingle();
    if (error) throw new Error(`vehicle: ${error.message}`);
    return data;
  }

  async function writeVehicleReliability(vehicleId, reliability) {
    const { data, error } = await supabase
      .from('vehicles')
      .update({ reliability })
      .eq('id', vehicleId)
      .select(VEHICLE_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(`vehicle: ${error.message}`);
    return data;
  }

  function auditReason(value) {
    return String(value || '').trim().slice(0, 200) || null;
  }

  router.post('/vehicles/:vehicleId/reliability', writeRateLimit, async (req, res) => {
    const vehicleId = String(req.params.vehicleId || '').trim();
    const reliability = parseInteger(req.body?.reliability);

    if (reliability === null || reliability < 0 || reliability > 100) {
      return res.status(400).json({ error: 'reliability must be an integer between 0 and 100' });
    }

    try {
      const vehicle = await findVehicle(vehicleId);
      if (!vehicle) {
        return res.status(404).json({ error: 'Vehicle not found' });
      }

      const previousReliability = Number(vehicle.reliability || 0);
      const changed = previousReliability !== reliability;
      let updated = vehicle;

      if (changed) {
        updated = await writeVehicleReliability(vehicleId, reliability);
        await recordAuditEvent(supabase, {
          ...gmActor(req),
          agencyId: vehicle.agency_id,
          action: 'GM_VEHICLE_RELIABILITY',
          entityType: 'vehicle',
          entityId: vehicleId,
          beforeData: { reliability: previousReliability },
          afterData: { reliability },
          deltaData: { reliability: reliability - previousReliability },
          metadata: {
            vehicle_name: vehicle.name,
            vehicle_type: vehicle.type,
            status: vehicle.status,
            reason: auditReason(req.body?.reason),
            ip: req.ip || null,
          },
        });
      }

      res.json({
        vehicle: updated,
        previous_reliability: previousReliability,
        reliability,
        changed,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/vehicles/:vehicleId/repair', writeRateLimit, async (req, res) => {
    const vehicleId = String(req.params.vehicleId || '').trim();
    const requestedBonus = req.body?.bonus === undefined
      ? DEFAULT_REPAIR_BONUS
      : parseInteger(req.body.bonus);

    if (requestedBonus === null || requestedBonus < 1 || requestedBonus > MAX_REPAIR_BONUS) {
      return res.status(400).json({
        error: `bonus must be an integer between 1 and ${MAX_REPAIR_BONUS}`,
      });
    }

    try {
      const vehicle = await findVehicle(vehicleId);
      if (!vehicle) {
        return res.status(404).json({ error: 'Vehicle not found' });
      }

      const previousReliability = Number(vehicle.reliability || 0);
      const reliability = Math.min(MAX_RELIABILITY, previousReliability + requestedBonus);
      const applied = reliability - previousReliability;
      let updated = vehicle;

      if (applied > 0) {
        updated = await writeVehicleReliability(vehicleId, reliability);
        await recordAuditEvent(supabase, {
          ...gmActor(req),
          agencyId: vehicle.agency_id,
          action: 'GM_VEHICLE_REPAIRED',
          entityType: 'vehicle',
          entityId: vehicleId,
          beforeData: { reliability: previousReliability },
          afterData: { reliability },
          deltaData: { reliability: applied },
          metadata: {
            vehicle_name: vehicle.name,
            vehicle_type: vehicle.type,
            status: vehicle.status,
            requested_bonus: requestedBonus,
            cap: MAX_RELIABILITY,
            reason: auditReason(req.body?.reason),
            ip: req.ip || null,
          },
        });
      }

      res.json({
        vehicle: updated,
        previous_reliability: previousReliability,
        reliability,
        applied,
        capped: reliability >= MAX_RELIABILITY,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
