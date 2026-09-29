const express = require('express');
const router = express.Router();
const AGMEngine = require('../services/agm');

module.exports = (supabase) => {
  // Launch mission
  router.post('/mission', async (req, res) => {
    try {
      const { agencyId, missionName, vehicleId, missionType } = req.body;

      if (!agencyId || !missionName || !vehicleId || !missionType) {
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

      // Get vehicle
      const { data: vehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .single();

      if (vehicleError || !vehicle) {
        return res.status(404).json({ error: 'Vehicle not found' });
      }

      // Calculate mission cost and simulate
      const missionCost = AGMEngine.calculateMissionCost(missionType);
      const simulation = AGMEngine.simulateMission(
        agency,
        vehicle,
        missionType
      );

      // Validate resources
      if (agency.ap < missionCost.ap || agency.budget < missionCost.budget) {
        return res.status(400).json({ error: 'Insufficient resources' });
      }

      // Deduct resources
      const newAp = agency.ap - missionCost.ap;
      const newBudget = agency.budget - missionCost.budget;
      const newRp = agency.rp + simulation.rpGain;
      const newIpi = Math.max(0, Math.min(100, agency.ipi + simulation.ipiChange));
      const newSi = Math.max(0, Math.min(100, agency.si + simulation.siChange));
      const newTotalLaunches = agency.total_launches + 1;
      const newSuccessfulLaunches = simulation.success ? agency.successful_launches + 1 : agency.successful_launches;
      const newSlr = Math.round((newSuccessfulLaunches / newTotalLaunches) * 100);

      // Update agency
      await supabase
        .from('agencies')
        .update({
          ap: newAp,
          budget: newBudget,
          rp: newRp,
          ipi: newIpi,
          si: newSi,
          total_launches: newTotalLaunches,
          successful_launches: newSuccessfulLaunches,
          slr: newSlr
        })
        .eq('id', agencyId);

      // Create mission log
      const { data: mission } = await supabase
        .from('missions')
        .insert([
          {
            agency_id: agencyId,
            name: missionName,
            vehicle_id: vehicleId,
            type: missionType,
            result: simulation.success ? 'success' : 'failure',
            ap_cost: missionCost.ap,
            budget_cost: missionCost.budget,
            crew_deaths: simulation.crewDeaths || 0,
            launched_at: new Date().toISOString(),
            completed_at: new Date().toISOString()
          }
        ])
        .select();

      // Log event
      await supabase
        .from('logs')
        .insert([
          {
            agency_id: agencyId,
            event_type: 'MISSION_COMPLETED',
            description: `Mission ${simulation.success ? 'succeeded' : 'failed'}: ${missionName}`,
            data: {
              mission_id: mission[0].id,
              mission_name: missionName,
              result: simulation.success ? 'success' : 'failure',
              simulation_score: simulation.finalScore,
              rp_gain: simulation.rpGain,
              ipi_change: simulation.ipiChange,
              si_change: simulation.siChange
            }
          }
        ]);

      res.status(201).json({
        message: 'Mission completed',
        mission: mission[0],
        simulation,
        newStats: {
          ap: newAp,
          budget: newBudget,
          rp: newRp,
          ipi: newIpi,
          si: newSi,
          slr: newSlr
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};