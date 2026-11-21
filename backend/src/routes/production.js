const express = require('express');
const {
  createAuthMiddleware,
  createAgencyOwnershipMiddleware,
} = require('../middleware/auth');
const { createRateLimitMiddleware } = require('../middleware/rateLimit');
const AGMEngine = require('../services/agm');
const { loadActiveSeason, gameDaysToRealMs, MS_PER_DAY } = require('../services/gameClock');
const { productionGameDaysForType } = require('../services/productionEngine');
const { VEHICLE_PERFORMANCE } = require('../services/missionFeasibility');
const { recordAuditEvent, playerActor } = require('../services/auditLog');

const VEHICLE_CLASSES = new Set([
  'suborbital',
  'orbital',
  'orbital-payload',
  'crewed',
  'deep-space',
]);

const PERFORMANCE_NUMERIC_FIELDS = Object.freeze({
  dry_mass_kg: { label: 'Dry mass', max: 10000000 },
  propellant_mass_kg: { label: 'Propellant mass', max: 10000000 },
  payload_capacity_kg: { label: 'Payload capacity', max: 10000000 },
  delta_v_budget_m_s: { label: 'Delta-v budget', max: 1000000 },
  crew_capacity: { label: 'Crew capacity', max: 20, integer: true },
});

const PERFORMANCE_FIELDS = Object.freeze([
  'vehicle_class',
  ...Object.keys(PERFORMANCE_NUMERIC_FIELDS),
]);

const PERFORMANCE_NOTE_MAX_LENGTH = 240;

function requestError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  if (details) error.details = details;
  return error;
}

function performanceMigrationMissing(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    /column .* does not exist/i.test(message) ||
    /Could not find the '.*' column/i.test(message)
  );
}

function parsePerformanceUpdate(body) {
  const updates = {};
  const fieldErrors = {};
  let supplied = false;

  if (Object.prototype.hasOwnProperty.call(body, 'vehicle_class')) {
    supplied = true;
    const value = String(body.vehicle_class ?? '').trim().toLowerCase();
    if (!VEHICLE_CLASSES.has(value)) {
      fieldErrors.vehicle_class = `Vehicle class must be one of: ${[...VEHICLE_CLASSES].join(', ')}`;
    } else {
      updates.vehicle_class = value;
    }
  }

  for (const [field, rule] of Object.entries(PERFORMANCE_NUMERIC_FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    supplied = true;
    const raw = body[field];
    if (raw === null || raw === undefined || raw === '') {
      fieldErrors[field] = `${rule.label} is required`;
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > rule.max) {
      fieldErrors[field] = `${rule.label} must be between 0 and ${rule.max}`;
    } else if (rule.integer && !Number.isInteger(value)) {
      fieldErrors[field] = `${rule.label} must be a whole number`;
    } else {
      updates[field] = value;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'performance_note')) {
    supplied = true;
    const note = String(body.performance_note ?? '').trim();
    if (note.length > PERFORMANCE_NOTE_MAX_LENGTH) {
      fieldErrors.performance_note = `Performance note cannot exceed ${PERFORMANCE_NOTE_MAX_LENGTH} characters`;
    } else {
      updates.performance_note = note || null;
    }
  }

  if (!supplied) {
    throw requestError(400, 'No performance fields supplied');
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw requestError(400, Object.values(fieldErrors)[0], { fields: fieldErrors });
  }
  return updates;
}

function performanceSnapshot(vehicle) {
  if (!vehicle) return null;
  const snapshot = {};
  for (const field of [...PERFORMANCE_FIELDS, 'performance_note']) {
    snapshot[field] = vehicle[field] ?? null;
  }
  return snapshot;
}

function changedPerformanceFields(before, after) {
  return [...PERFORMANCE_FIELDS, 'performance_note'].filter((field) => {
    const previous = before?.[field] ?? null;
    const next = after?.[field] ?? null;
    if (field === 'vehicle_class' || field === 'performance_note') {
      return String(previous ?? '') !== String(next ?? '');
    }
    if (previous === null || next === null) return previous !== next;
    return Number(previous) !== Number(next);
  });
}

function performanceDelta(beforeData, afterData, fields) {
  return Object.fromEntries(fields.map((field) => {
    const previous = beforeData?.[field] ?? null;
    const next = afterData?.[field] ?? null;
    if (!['vehicle_class', 'performance_note'].includes(field) && previous !== null && next !== null) {
      const numericDelta = Number(next) - Number(previous);
      if (Number.isFinite(numericDelta)) {
        return [field, numericDelta];
      }
    }
    return [field, next];
  }));
}

module.exports = (supabase, deps = {}) => {
  const router = express.Router();
  const authenticate = deps.authenticate || createAuthMiddleware(supabase);
  const requireOwnedAgency = deps.requireOwnedAgency || createAgencyOwnershipMiddleware(supabase);
  const writeRateLimit = deps.writeRateLimit
    || createRateLimitMiddleware({ windowMs: 60000, max: 30 });

  router.use(authenticate);

  // Queue vehicle production. Completion is handled by the scheduled-event worker.
  router.post('/vehicle', writeRateLimit, requireOwnedAgency, async (req, res) => {
    const { agencyId, vehicleName, vehicleType } = req.body || {};

    if (!agencyId || !vehicleName || !vehicleType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      const [{ data: agency, error: agencyError }, season] = await Promise.all([
        supabase.from('agencies').select('*').eq('id', agencyId).single(),
        loadActiveSeason(supabase),
      ]);

      if (agencyError || !agency) {
        return res.status(404).json({ error: 'Agency not found' });
      }

      const productionCost = AGMEngine.calculateProductionCost(vehicleType);
      const validation = AGMEngine.validateProduction(agency, productionCost);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.message });
      }

      const multiplier = Number(season.time_scale_multiplier) || 52.142857;
      const productionGameDays = productionGameDaysForType(vehicleType);
      const productionRealMs = gameDaysToRealMs(productionGameDays, multiplier);
      const productionDays = Math.max(1, Math.ceil(productionRealMs / MS_PER_DAY));
      const startedAt = new Date();
      const completesAt = new Date(startedAt.getTime() + productionRealMs);
      const startedAtIso = startedAt.toISOString();
      const completesAtIso = completesAt.toISOString();

      const newFunding = Number(agency.funding_usd || 0) - productionCost.funding_usd;

      let vehicle = null;
      let scheduledEvent = null;
      let agencyWritten = false;
      let vehicleWritten = false;

      try {
        const { data: createdVehicle, error: vehicleError } = await supabase
          .from('vehicles')
          .insert([{
            agency_id: agencyId,
            name: vehicleName,
            type: vehicleType,
            reliability: 70,
            status: 'manufacturing',
            total_launches: 0,
            successful_launches: 0,
            trl: 4,
            architecture_family: vehicleType,
            factory_line: 'BAY-01',
          }])
          .select()
          .single();

        if (vehicleError || !createdVehicle) {
          throw new Error(`vehicles: ${vehicleError?.message || 'insert failed'}`);
        }
        vehicle = createdVehicle;
        vehicleWritten = true;

        const { data: updatedAgency, error: agencyUpdateError } = await supabase
          .from('agencies')
          .update({ funding_usd: newFunding })
          .eq('id', agencyId)
          .eq('funding_usd', agency.funding_usd)
          .select('id')
          .maybeSingle();

        if (agencyUpdateError) throw new Error(`agencies update: ${agencyUpdateError.message}`);
        if (!updatedAgency) throw new Error('Agency resources changed; retry the request');
        agencyWritten = true;

        const payload = {
          agency_id: agencyId,
          vehicle_id: vehicle.id,
          vehicle_name: vehicleName,
          vehicle_type: vehicleType,
          production_game_days: productionGameDays,
          production_days: productionDays,
          started_at: startedAtIso,
          completes_at: completesAtIso,
        };

        const { data: eventRow, error: eventError } = await supabase
          .from('scheduled_events')
          .insert([{
            season_id: agency.season_id || season.id,
            agency_id: agencyId,
            event_type: 'PRODUCTION_COMPLETE',
            reference_id: vehicle.id,
            payload,
            execute_at: completesAtIso,
            status: 'PENDING',
          }])
          .select()
          .single();

        if (eventError || !eventRow) {
          throw new Error(`scheduled_events: ${eventError?.message || 'insert failed'}`);
        }
        scheduledEvent = eventRow;

        const { error: logError } = await supabase
          .from('logs')
          .insert([{
            agency_id: agencyId,
            event_type: 'PRODUCTION_STARTED',
            description: `Assembly started: ${vehicleName} (${vehicleType})`,
            data: {
              event_id: eventRow.id,
              vehicle_id: vehicle.id,
              vehicle_name: vehicleName,
              vehicle_type: vehicleType,
              cost_funding_usd: productionCost.funding_usd,
              production_days: productionDays,
              production_game_days: productionGameDays,
              production_completes_at: completesAtIso,
            },
          }]);

        if (logError) throw new Error(`logs: ${logError.message}`);

        await recordAuditEvent(supabase, {
          ...playerActor(req),
          seasonId: agency.season_id || season.id,
          agencyId,
          action: 'PRODUCTION_STARTED',
          entityType: 'vehicle',
          entityId: vehicle.id,
          beforeData: { funding_usd: Number(agency.funding_usd || 0) },
          afterData: { funding_usd: newFunding },
          deltaData: { funding_usd: -productionCost.funding_usd },
          metadata: {
            vehicle_name: vehicleName,
            vehicle_type: vehicleType,
            production_game_days: productionGameDays,
          },
        });
      } catch (error) {
        const rollbackErrors = [];

        if (scheduledEvent) {
          const { error: cancelError } = await supabase
            .from('scheduled_events')
            .update({ status: 'CANCELLED', last_error: error.message })
            .eq('id', scheduledEvent.id)
            .eq('status', 'PENDING');
          if (cancelError) rollbackErrors.push(cancelError.message);
        }

        if (agencyWritten) {
          const { error: restoreAgencyError } = await supabase
            .from('agencies')
            .update({ funding_usd: agency.funding_usd })
            .eq('id', agencyId);
          if (restoreAgencyError) rollbackErrors.push(restoreAgencyError.message);
        }

        if (vehicleWritten) {
          const { error: deleteVehicleError } = await supabase
            .from('vehicles')
            .delete()
            .eq('id', vehicle.id);
          if (deleteVehicleError) rollbackErrors.push(deleteVehicleError.message);
        }

        if (rollbackErrors.length > 0) {
          console.error('Production start rollback failed:', rollbackErrors.join('; '));
        }

        throw error;
      }

      res.status(202).json({
        message: 'Production started',
        vehicle,
        productionDays,
        productionGameDays,
        productionCompletesAt: completesAtIso,
        eventId: scheduledEvent.id,
        newStats: {
          funding_usd: newFunding,
          science_points: Number(agency.science_points || 0),
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Edit the persisted performance envelope used by mission feasibility checks.
  router.patch('/vehicle/:vehicleId/performance', writeRateLimit, requireOwnedAgency, async (req, res) => {
    const agencyId = String(req.body?.agencyId || '').trim();
    const vehicleId = String(req.params.vehicleId || '').trim();
    const resetToDefaults = req.body?.resetToDefaults === true;

    if (!vehicleId) {
      return res.status(400).json({ error: 'vehicleId is required' });
    }

    try {
      const updates = resetToDefaults ? null : parsePerformanceUpdate(req.body || {});
      const [{ data: vehicle, error: vehicleError }, season] = await Promise.all([
        supabase
          .from('vehicles')
          .select('*')
          .eq('id', vehicleId)
          .eq('agency_id', agencyId)
          .maybeSingle(),
        loadActiveSeason(supabase),
      ]);

      if (vehicleError) throw new Error(`vehicles: ${vehicleError.message}`);
      if (!vehicle) {
        return res.status(404).json({
          error: 'VEHICLE_NOT_FOUND',
          message: 'Vehicle not found for this agency.',
        });
      }

      const defaults = VEHICLE_PERFORMANCE[vehicle.type] || null;
      let patch = updates;
      if (resetToDefaults) {
        if (!defaults) {
          return res.status(400).json({
            error: 'NO_DEFAULT_PROFILE',
            message: `Vehicle type ${vehicle.type || 'unknown'} has no default performance profile.`,
          });
        }
        patch = { ...defaults, performance_note: null };
      }

      const { data: updatedVehicle, error: updateError } = await supabase
        .from('vehicles')
        .update(patch)
        .eq('id', vehicleId)
        .eq('agency_id', agencyId)
        .select('*')
        .single();

      if (updateError) throw updateError;
      if (!updatedVehicle) {
        return res.status(404).json({
          error: 'VEHICLE_NOT_FOUND',
          message: 'Vehicle not found for this agency.',
        });
      }

      const changedFields = changedPerformanceFields(vehicle, updatedVehicle);
      if (changedFields.length > 0) {
        const beforeData = performanceSnapshot(vehicle);
        const afterData = performanceSnapshot(updatedVehicle);
        await recordAuditEvent(supabase, {
          ...playerActor(req),
          seasonId: season.id,
          agencyId,
          action: 'VEHICLE_PERFORMANCE_UPDATED',
          entityType: 'vehicle',
          entityId: vehicleId,
          beforeData,
          afterData,
          deltaData: performanceDelta(beforeData, afterData, changedFields),
          metadata: {
            vehicle_name: updatedVehicle.name,
            vehicle_type: updatedVehicle.type,
            reset_to_defaults: resetToDefaults,
            changed_fields: changedFields,
          },
        });
      }

      res.json({
        vehicle: updatedVehicle,
        defaults,
        changed_fields: changedFields,
        reset_to_defaults: resetToDefaults,
      });
    } catch (error) {
      if (performanceMigrationMissing(error)) {
        return res.status(503).json({
          error: 'PERFORMANCE_MIGRATION_REQUIRED',
          message: 'Apply migration 013_mission_feasibility.sql first.',
        });
      }
      const status = Number(error.status) || (String(error.code || '') === '23514' ? 400 : 500);
      const payload = {
        error: status >= 500 ? 'PERFORMANCE_UPDATE_FAILED' : error.message,
        message: error.message,
      };
      if (error.details) payload.details = error.details;
      res.status(status).json(payload);
    }
  });

  return router;
};
