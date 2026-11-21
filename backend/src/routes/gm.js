const express = require('express');
const { createGmAuthMiddleware } = require('../middleware/gm');
const { createRateLimitMiddleware } = require('../middleware/rateLimit');
const {
  gameDateAt,
  gameDaysToRealMs,
  loadActiveSeason,
} = require('../services/gameClock');
const { recordAuditEvent, listAuditEvents, gmActor } = require('../services/auditLog');

const OPERATION_EVENT_TYPES = [
  'PRODUCTION_COMPLETE',
  'ROLLOUT_COMPLETE',
  'LAUNCH_IGNITION',
  'ORBIT_OPERATIONS_COMPLETE',
  'TECH_COMPLETE',
  'STATIC_FIRE',
];

const OPERATION_EVENT_SET = new Set(OPERATION_EVENT_TYPES);
const MAX_ADVANCE_GAME_DAYS = 3650;

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

  return router;
};
