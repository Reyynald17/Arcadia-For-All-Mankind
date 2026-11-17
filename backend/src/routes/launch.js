const express = require('express');
const { randomUUID } = require('node:crypto');
const AGMEngine = require('../services/agm');
const { loadActiveSeason, MS_PER_DAY } = require('../services/gameClock');
const { hashSeed } = require('../services/seededRng');
const {
  ACTIVE_MISSION_STATUSES,
  planLaunchSchedule,
} = require('../services/launchEngine');
const { azimuthForInclination } = require('../services/orbitalEngine');

const IN_FLIGHT_VEHICLE_STATUSES = new Set(['manufacturing', 'assigned']);

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

module.exports = (supabase) => {
  const router = express.Router();

  // Schedule a mission. Rollout and ignition are completed by the event worker.
  router.post('/mission', async (req, res) => {
    const body = req.body || {};
    const { agencyId, missionName, vehicleId, missionType } = body;

    if (!agencyId || !missionName || !vehicleId || !missionType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const targetInclinationInput = optionalNumber(body.targetInclinationDeg);
    const azimuthInput = optionalNumber(body.azimuthDeg);

    if (body.targetInclinationDeg !== undefined && targetInclinationInput === null) {
      return res.status(400).json({ error: 'targetInclinationDeg must be a number between 0 and 180' });
    }
    if (targetInclinationInput !== null && (targetInclinationInput < 0 || targetInclinationInput > 180)) {
      return res.status(400).json({ error: 'targetInclinationDeg must be between 0 and 180' });
    }
    if (body.azimuthDeg !== undefined && azimuthInput === null) {
      return res.status(400).json({ error: 'azimuthDeg must be a number between 0 and 360' });
    }
    if (azimuthInput !== null && (azimuthInput < 0 || azimuthInput > 360)) {
      return res.status(400).json({ error: 'azimuthDeg must be between 0 and 360' });
    }

    try {
      const [
        { data: agency, error: agencyError },
        { data: vehicle, error: vehicleError },
        season,
      ] = await Promise.all([
        supabase.from('agencies').select('*').eq('id', agencyId).single(),
        supabase.from('vehicles').select('*').eq('id', vehicleId).single(),
        loadActiveSeason(supabase),
      ]);

      if (agencyError || !agency) {
        return res.status(404).json({ error: 'Agency not found' });
      }
      if (vehicleError || !vehicle) {
        return res.status(404).json({ error: 'Vehicle not found' });
      }
      if (vehicle.agency_id !== agencyId) {
        return res.status(403).json({ error: 'Vehicle does not belong to this agency' });
      }
      if (IN_FLIGHT_VEHICLE_STATUSES.has(vehicle.status)) {
        return res.status(400).json({
          error: vehicle.status === 'manufacturing'
            ? 'Vehicle is still in production'
            : 'Vehicle is already assigned to another mission',
        });
      }

      const missionCost = AGMEngine.calculateMissionCost(missionType);
      const validation = AGMEngine.validateProduction(agency, missionCost);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.message });
      }

      const { data: activeMission, error: activeMissionError } = await supabase
        .from('missions')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .in('status', ACTIVE_MISSION_STATUSES)
        .limit(1)
        .maybeSingle();

      if (activeMissionError) throw new Error(`active mission: ${activeMissionError.message}`);
      if (activeMission) {
        return res.status(400).json({ error: 'Vehicle already has an active mission' });
      }

      const launchSiteLat = Number(agency.launch_site_lat || 0);
      const launchSiteLon = Number(agency.launch_site_lon || 0);
      const targetInclination =
        targetInclinationInput === null ? Math.abs(launchSiteLat) : targetInclinationInput;
      if (targetInclination < Math.abs(launchSiteLat)) {
        return res.status(400).json({
          error: `targetInclinationDeg cannot be below the launch site latitude (${Math.abs(launchSiteLat)})`,
        });
      }

      const computedAzimuth = azimuthInput === null
        ? azimuthForInclination(launchSiteLat, targetInclination)
        : azimuthInput;
      if (computedAzimuth === null) {
        return res.status(400).json({
          error: 'Target inclination is unreachable from this launch site without a plane change',
        });
      }

      const multiplier = Number(season.time_scale_multiplier) || 52.142857;
      const missionSeed = hashSeed(randomUUID());
      const schedule = planLaunchSchedule({
        missionSeed,
        multiplier,
        now: new Date(),
      });

      const scheduledLaunchMs = new Date(schedule.scheduledLaunchAt).getTime() - Date.now();
      const scheduledLaunchDays = Math.max(1, Math.ceil(scheduledLaunchMs / MS_PER_DAY));
      const newFunding = Number(agency.funding_usd || 0) - missionCost.funding_usd;
      const seasonId = agency.season_id || season.id;

      let mission = null;
      let rolloutEvent = null;
      let ignitionEvent = null;
      let missionWritten = false;
      let vehicleReserved = false;
      let agencyWritten = false;

      try {
        const { data: createdMission, error: missionError } = await supabase
          .from('missions')
          .insert([{
            agency_id: agencyId,
            season_id: seasonId,
            name: missionName,
            vehicle_id: vehicleId,
            type: missionType,
            result: null,
            ap_cost: 0,
            budget_cost: 0,
            crew_deaths: 0,
            status: 'ROLLOUT',
            scheduled_launch_at: schedule.scheduledLaunchAt,
            launch_site_lat: launchSiteLat,
            launch_site_lon: launchSiteLon,
            target_inclination_deg: targetInclination,
            azimuth_deg: computedAzimuth,
            mission_seed: missionSeed,
            telemetry: {
              rollout_game_days: schedule.rolloutGameDays,
              countdown_game_days: schedule.countdownGameDays,
              rollout_completes_at: schedule.rolloutCompletesAt,
              scheduled_launch_at: schedule.scheduledLaunchAt,
              time_scale_multiplier: multiplier,
              cost_funding_usd: missionCost.funding_usd,
            },
          }])
          .select()
          .single();

        if (missionError || !createdMission) {
          throw new Error(`missions: ${missionError?.message || 'insert failed'}`);
        }
        mission = createdMission;
        missionWritten = true;

        const { data: reservedVehicle, error: reserveError } = await supabase
          .from('vehicles')
          .update({ status: 'assigned' })
          .eq('id', vehicleId)
          .eq('status', vehicle.status)
          .select('id')
          .maybeSingle();

        if (reserveError) throw new Error(`vehicle reserve: ${reserveError.message}`);
        if (!reservedVehicle) throw new Error('Vehicle state changed; retry the request');
        vehicleReserved = true;

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
          mission_id: mission.id,
          mission_name: missionName,
          vehicle_id: vehicleId,
          vehicle_name: vehicle.name,
          vehicle_type: vehicle.type,
          vehicle_reliability: vehicle.reliability,
          agency_rp: agency.rp,
          mission_seed: missionSeed,
          time_scale_multiplier: multiplier,
          launch_site_lat: launchSiteLat,
          launch_site_lon: launchSiteLon,
          target_inclination_deg: targetInclination,
          azimuth_deg: computedAzimuth,
          rollout_game_days: schedule.rolloutGameDays,
          countdown_game_days: schedule.countdownGameDays,
          rollout_completes_at: schedule.rolloutCompletesAt,
          scheduled_launch_at: schedule.scheduledLaunchAt,
        };

        const { data: rolloutRow, error: rolloutError } = await supabase
          .from('scheduled_events')
          .insert([{
            season_id: seasonId,
            agency_id: agencyId,
            event_type: 'ROLLOUT_COMPLETE',
            reference_id: mission.id,
            payload,
            execute_at: schedule.rolloutCompletesAt,
            status: 'PENDING',
          }])
          .select()
          .single();

        if (rolloutError || !rolloutRow) {
          throw new Error(`rollout event: ${rolloutError?.message || 'insert failed'}`);
        }
        rolloutEvent = rolloutRow;

        const { data: ignitionRow, error: ignitionError } = await supabase
          .from('scheduled_events')
          .insert([{
            season_id: seasonId,
            agency_id: agencyId,
            event_type: 'LAUNCH_IGNITION',
            reference_id: mission.id,
            payload,
            execute_at: schedule.scheduledLaunchAt,
            status: 'PENDING',
          }])
          .select()
          .single();

        if (ignitionError || !ignitionRow) {
          throw new Error(`ignition event: ${ignitionError?.message || 'insert failed'}`);
        }
        ignitionEvent = ignitionRow;

        const { error: logError } = await supabase
          .from('logs')
          .insert([{
            agency_id: agencyId,
            event_type: 'LAUNCH_SCHEDULED',
            description: `Launch scheduled: ${missionName}`,
            data: {
              mission_id: mission.id,
              mission_name: missionName,
              mission_type: missionType,
              vehicle_id: vehicleId,
              mission_seed: missionSeed,
              rollout_event_id: rolloutRow.id,
              ignition_event_id: ignitionRow.id,
              cost_funding_usd: missionCost.funding_usd,
              rollout_completes_at: schedule.rolloutCompletesAt,
              scheduled_launch_at: schedule.scheduledLaunchAt,
              launch_site_lat: launchSiteLat,
              launch_site_lon: launchSiteLon,
              target_inclination_deg: targetInclination,
              azimuth_deg: computedAzimuth,
            },
          }]);

        if (logError) throw new Error(`logs: ${logError.message}`);
      } catch (error) {
        const rollbackErrors = [];

        for (const pendingEvent of [ignitionEvent, rolloutEvent]) {
          if (!pendingEvent) continue;
          const { error: cancelError } = await supabase
            .from('scheduled_events')
            .update({ status: 'CANCELLED', last_error: error.message })
            .eq('id', pendingEvent.id)
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

        if (vehicleReserved) {
          const { error: releaseError } = await supabase
            .from('vehicles')
            .update({ status: vehicle.status })
            .eq('id', vehicleId)
            .eq('status', 'assigned');
          if (releaseError) rollbackErrors.push(releaseError.message);
        }

        if (missionWritten) {
          const { error: deleteMissionError } = await supabase
            .from('missions')
            .delete()
            .eq('id', mission.id);
          if (deleteMissionError) rollbackErrors.push(deleteMissionError.message);
        }

        if (rollbackErrors.length > 0) {
          console.error('Launch scheduling rollback failed:', rollbackErrors.join('; '));
        }

        throw error;
      }

      res.status(202).json({
        message: 'Launch scheduled',
        mission,
        missionSeed,
        rolloutGameDays: schedule.rolloutGameDays,
        countdownGameDays: schedule.countdownGameDays,
        rolloutCompletesAt: schedule.rolloutCompletesAt,
        scheduledLaunchAt: schedule.scheduledLaunchAt,
        scheduledLaunchDays,
        events: {
          rolloutEventId: rolloutEvent.id,
          ignitionEventId: ignitionEvent.id,
        },
        newStats: {
          funding_usd: newFunding,
          science_points: Number(agency.science_points || 0),
          rp: agency.rp,
          ipi: agency.ipi,
          si: agency.si,
          slr: agency.slr,
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
