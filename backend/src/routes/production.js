const express = require('express');
const AGMEngine = require('../services/agm');
const { loadActiveSeason, gameDaysToRealMs, MS_PER_DAY } = require('../services/gameClock');
const { productionGameDaysForType } = require('../services/productionEngine');

module.exports = (supabase) => {
  const router = express.Router();

  // Queue vehicle production. Completion is handled by the scheduled-event worker.
  router.post('/vehicle', async (req, res) => {
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

  return router;
};
