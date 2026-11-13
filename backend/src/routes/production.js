const express = require('express');
const router = express.Router();
const AGMEngine = require('../services/agm');

module.exports = (supabase) => {
  // Produce vehicle
  router.post('/vehicle', async (req, res) => {
    try {
      const { agencyId, vehicleName, vehicleType } = req.body;

      if (!agencyId || !vehicleName || !vehicleType) {
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

      // Validate production with AGM
      const productionCost = AGMEngine.calculateProductionCost(vehicleType);
      const validation = AGMEngine.validateProduction(agency, productionCost);

      if (!validation.valid) {
        return res.status(400).json({ error: validation.message });
      }

      // Create vehicle
      const { data: vehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .insert([
          {
            agency_id: agencyId,
            name: vehicleName,
            type: vehicleType,
            reliability: 70,
            status: 'testing',
            total_launches: 0,
            successful_launches: 0
          }
        ])
        .select();

      if (vehicleError) {
        return res.status(400).json({ error: vehicleError.message });
      }

      // Deduct budget and AP
      const newBudget = agency.budget - productionCost.budget;
      const newAp = agency.ap - productionCost.ap;

      await supabase
        .from('agencies')
        .update({ budget: newBudget, ap: newAp })
        .eq('id', agencyId);

      // Log production
      await supabase
        .from('logs')
        .insert([
          {
            agency_id: agencyId,
            event_type: 'PRODUCTION_COMPLETED',
            description: `Vehicle produced: ${vehicleName} (${vehicleType})`,
            data: {
              vehicle_id: vehicle[0].id,
              vehicle_name: vehicleName,
              vehicle_type: vehicleType,
              cost_budget: productionCost.budget,
              cost_ap: productionCost.ap
            }
          }
        ]);

      res.status(201).json({
        message: 'Vehicle produced successfully',
        vehicle: vehicle[0],
        newBudget,
        newAp
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};