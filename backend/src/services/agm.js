/**
 * AGM – Automated Game Master Engine
 * Deterministic simulation without AI
 */

const AGMEngine = {
  /**
   * Validate research can start
   */
  validateResearch(agency, technology) {
    if (agency.ap < technology.research_cost_ap) {
      return { valid: false, message: 'Insufficient AP' };
    }
    if (agency.budget < technology.research_cost_budget) {
      return { valid: false, message: 'Insufficient budget' };
    }
    return { valid: true };
  },

  /**
   * Calculate production cost for vehicle type
   */
  calculateProductionCost(vehicleType) {
    const costs = {
      'sounding-rocket': { ap: 5, budget: 10 },
      'orbital-rocket': { ap: 8, budget: 20 },
      'satellite': { ap: 6, budget: 15 },
      'capsule': { ap: 10, budget: 30 },
      'probe': { ap: 7, budget: 18 },
      'lander': { ap: 12, budget: 40 }
    };
    return costs[vehicleType] || { ap: 5, budget: 10 };
  },

  /**
   * Validate production can start
   */
  validateProduction(agency, productionCost) {
    if (agency.ap < productionCost.ap) {
      return { valid: false, message: 'Insufficient AP' };
    }
    if (agency.budget < productionCost.budget) {
      return { valid: false, message: 'Insufficient budget' };
    }
    return { valid: true };
  },

  /**
   * Calculate mission cost
   */
  calculateMissionCost(missionType) {
    const costs = {
      'test': { ap: 3, budget: 5 },
      'scientific': { ap: 5, budget: 15 },
      'manned': { ap: 8, budget: 30 },
      'colonial': { ap: 15, budget: 50 }
    };
    return costs[missionType] || { ap: 3, budget: 5 };
  },

  /**
   * Simulate mission outcome (deterministic)
   */
  simulateMission(agency, vehicle, missionType) {
    // Base calculation
    let baseReliability = vehicle.reliability;
    let techBonus = Math.floor(agency.rp / 20); // RP contributes to tech bonus
    let crewBonus = 5; // Placeholder

    // Mission difficulty modifier
    const difficultyMap = {
      'test': -5,
      'scientific': -10,
      'manned': -20,
      'colonial': -30
    };
    let difficulty = difficultyMap[missionType] || -10;

    // Random variance (-5 to +5)
    let randomVariance = (Math.random() * 10) - 5;

    // Calculate final score
    let finalScore = baseReliability + techBonus + crewBonus + difficulty + randomVariance;
    finalScore = Math.max(0, Math.min(100, finalScore));

    // Determine outcome
    let success = finalScore >= 50;
    let rpGain = 0;
    let ipiChange = 0;
    let siChange = 0;
    let crewDeaths = 0;

    if (finalScore >= 80) {
      // Complete success
      rpGain = 10;
      ipiChange = 5;
      siChange = 5;
    } else if (finalScore >= 50) {
      // Partial success
      rpGain = 5;
      ipiChange = 2;
      siChange = 2;
    } else if (finalScore >= 30) {
      // Failure
      rpGain = 0;
      ipiChange = -10;
      siChange = -5;
    } else {
      // Catastrophic failure
      rpGain = 0;
      ipiChange = -20;
      siChange = -15;
      crewDeaths = missionType === 'manned' ? 1 : 0;
    }

    return {
      success,
      finalScore: Math.round(finalScore),
      rpGain,
      ipiChange,
      siChange,
      crewDeaths
    };
  },

  /**
   * Distribute AP periodically
   */
  distributeAP(agency) {
    const maxAP = 50;
    const addAP = 25;
    const newAP = Math.min(maxAP, agency.ap + addAP);
    return newAP;
  },

  /**
   * Calculate SLR (Successful Launch Rate)
   */
  calculateSLR(totalLaunches, successfulLaunches) {
    if (totalLaunches === 0) return 0;
    return Math.round((successfulLaunches / totalLaunches) * 100);
  }
};

module.exports = AGMEngine;