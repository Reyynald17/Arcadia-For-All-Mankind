/**
 * NPC Autopilot Service
 * NPCs conduct autonomous research, production, and missions
 */

const AGMEngine = require('./agm');

const NPCService = {
  /**
   * Execute NPC turn (research, production, or launch)
   */
  async executeNPCTurn(supabase, npc) {
    try {
      // Randomly select action
      const action = Math.random();

      if (action < 0.4) {
        // Research
        await this.conductResearch(supabase, npc);
      } else if (action < 0.7) {
        // Production
        await this.produceVehicle(supabase, npc);
      } else {
        // Launch
        await this.launchMission(supabase, npc);
      }
    } catch (error) {
      console.error('NPC turn error:', error.message);
    }
  },

  /**
   * NPC conducts research
   */
  async conductResearch(supabase, npc) {
    try {
      // Get available technologies
      const { data: technologies } = await supabase
        .from('technologies')
        .select('*')
        .limit(1);

      if (!technologies || technologies.length === 0) return;

      const tech = technologies[0];
      const cost = tech.research_cost_ap;

      if (npc.ap >= cost) {
        await supabase
          .from('npcs')
          .update({ ap: npc.ap - cost })
          .eq('id', npc.id);

        console.log(`NPC ${npc.name} started research: ${tech.name}`);
      }
    } catch (error) {
      console.error('NPC research error:', error.message);
    }
  },

  /**
   * NPC produces vehicle
   */
  async produceVehicle(supabase, npc) {
    try {
      const vehicleTypes = [
        'sounding-rocket',
        'orbital-rocket',
        'satellite',
        'capsule'
      ];
      const vehicleType = vehicleTypes[Math.floor(Math.random() * vehicleTypes.length)];
      const cost = AGMEngine.calculateProductionCost(vehicleType);

      if (npc.ap >= cost.ap && npc.budget >= cost.budget) {
        await supabase
          .from('npcs')
          .update({
            ap: npc.ap - cost.ap,
            budget: npc.budget - cost.budget
          })
          .eq('id', npc.id);

        console.log(`NPC ${npc.name} produced vehicle: ${vehicleType}`);
      }
    } catch (error) {
      console.error('NPC production error:', error.message);
    }
  },

  /**
   * NPC launches mission
   */
  async launchMission(supabase, npc) {
    try {
      const missionTypes = ['test', 'scientific', 'manned'];
      const missionType = missionTypes[Math.floor(Math.random() * missionTypes.length)];
      const cost = AGMEngine.calculateMissionCost(missionType);

      if (npc.ap >= cost.ap && npc.budget >= cost.budget) {
        // Simulate basic vehicle
        const mockVehicle = { reliability: 75 };
        const simulation = AGMEngine.simulateMission(npc, mockVehicle, missionType);

        // Update NPC stats
        const newTotalLaunches = npc.total_launches + 1;
        const newSuccessfulLaunches = simulation.success
          ? npc.successful_launches + 1
          : npc.successful_launches;
        const newSlr = (newSuccessfulLaunches / newTotalLaunches) * 100;

        await supabase
          .from('npcs')
          .update({
            ap: npc.ap - cost.ap,
            budget: npc.budget - cost.budget,
            rp: npc.rp + simulation.rpGain,
            ipi: Math.max(0, Math.min(100, npc.ipi + simulation.ipiChange)),
            si: Math.max(0, Math.min(100, npc.si + simulation.siChange)),
            slr: newSlr,
            total_launches: newTotalLaunches,
            successful_launches: newSuccessfulLaunches
          })
          .eq('id', npc.id);

        console.log(`NPC ${npc.name} launched ${missionType} mission. Result: ${simulation.success ? 'Success' : 'Failure'}`);
      }
    } catch (error) {
      console.error('NPC mission error:', error.message);
    }
  }
};

module.exports = NPCService;