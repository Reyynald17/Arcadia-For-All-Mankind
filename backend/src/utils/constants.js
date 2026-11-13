/**
 * Game constants and configuration
 */

const CONSTANTS = {
  // AP Configuration
  AP_MAX: 50,
  AP_DISTRIBUTION: 25,
  AP_DISTRIBUTION_DAYS: ['Tuesday', 'Thursday', 'Saturday', 'Sunday'],

  // Mission Types
  MISSION_TYPES: ['test', 'scientific', 'manned', 'colonial'],

  // Vehicle Types
  VEHICLE_TYPES: [
    'sounding-rocket',
    'orbital-rocket',
    'satellite',
    'capsule',
    'probe',
    'lander'
  ],

  // Stats Boundaries
  STATS: {
    RP_MIN: 0,
    SI_MIN: 0,
    SI_MAX: 100,
    SI_CRISIS_THRESHOLD: 30,
    IPI_MIN: 0,
    IPI_MAX: 100,
    IPI_LOW_THRESHOLD: 40,
    SLR_MIN: 0,
    SLR_MAX: 100
  },

  // Default Values
  DEFAULTS: {
    AGENCY: {
      AP: 25,
      BUDGET: 50,
      RP: 0,
      SI: 70,
      IPI: 60,
      SLR: 0
    },
    VEHICLE: {
      RELIABILITY: 70
    }
  },

  // Eras
  ERAS: [
    '1969-1975',
    '1975-1985',
    '1985-1995',
    '1995+'
  ]
};

module.exports = CONSTANTS;