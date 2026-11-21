/**
 * AGM – Automated Game Master Engine
 * Deterministic simulation without AI
 */

const AGMEngine = {
  /**
   * Validate research can start against the canonical economy.
   */
  validateResearch(agency, cost) {
    if (Number(agency.science_points || 0) < Number(cost.science_points || 0)) {
      return { valid: false, message: 'Insufficient science points' };
    }
    if (Number(agency.funding_usd || 0) < Number(cost.funding_usd || 0)) {
      return { valid: false, message: 'Insufficient funding' };
    }
    return { valid: true };
  },

  /**
   * Calculate production cost for vehicle type (canonical USD).
   */
  calculateProductionCost(vehicleType) {
    const costs = {
      'sounding-rocket': { funding_usd: 500000 },
      'orbital-rocket': { funding_usd: 2500000 },
      'satellite': { funding_usd: 1200000 },
      'capsule': { funding_usd: 3500000 },
      'probe': { funding_usd: 1800000 },
      'lander': { funding_usd: 5000000 },
    };
    return costs[vehicleType] || { funding_usd: 500000 };
  },

  /**
   * Validate production can start.
   */
  validateProduction(agency, productionCost) {
    if (Number(agency.funding_usd || 0) < Number(productionCost.funding_usd || 0)) {
      return { valid: false, message: 'Insufficient funding' };
    }
    return { valid: true };
  },

  /**
   * Simulate mission outcome (deterministic)
   */
  simulateMission(agency, vehicle, missionType, rng = Math.random) {
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

    // Random variance (-5 to +5), supplied by the deterministic mission seed
    const random = typeof rng === 'function' ? rng : Math.random;
    let randomVariance = (random() * 10) - 5;

    // Calculate final score
    let finalScore = baseReliability + techBonus + crewBonus + difficulty + randomVariance;
    finalScore = Math.max(0, Math.min(100, finalScore));

    // Determine outcome
    let success = finalScore >= 50;
    let rpGain = 0;
    let scienceGain = 0;
    let ipiChange = 0;
    let siChange = 0;
    let crewDeaths = 0;

    const scienceRewards = {
      'test': 20,
      'scientific': 50,
      'manned': 80,
      'colonial': 120,
    };
    const baseScience = scienceRewards[missionType] || 20;

    if (finalScore >= 80) {
      // Complete success
      rpGain = 10;
      scienceGain = baseScience;
      ipiChange = 5;
      siChange = 5;
    } else if (finalScore >= 50) {
      // Partial success
      rpGain = 5;
      scienceGain = Math.round(baseScience * 0.6);
      ipiChange = 2;
      siChange = 2;
    } else if (finalScore >= 30) {
      // Failure
      rpGain = 0;
      scienceGain = Math.round(baseScience * 0.15);
      ipiChange = -10;
      siChange = -5;
    } else {
      // Catastrophic failure
      rpGain = 0;
      scienceGain = 0;
      ipiChange = -20;
      siChange = -15;
      crewDeaths = missionType === 'manned' ? 1 : 0;
    }

    return {
      success,
      finalScore: Math.round(finalScore),
      rpGain,
      scienceGain,
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