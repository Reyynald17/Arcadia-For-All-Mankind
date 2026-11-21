const {
  calculateMissionCost,
  calculateMissionDuration,
} = require('./missionLogistics');

const MISSION_PROFILES = Object.freeze({
  test: {
    label: 'Orbital Test Flight',
    required_delta_v_m_s: 1900,
    payload_mass_kg: 100,
    crew_required: 0,
    allowed_vehicle_types: ['sounding-rocket', 'orbital-rocket'],
  },
  scientific: {
    label: 'Scientific Payload',
    required_delta_v_m_s: 3300,
    payload_mass_kg: 600,
    crew_required: 0,
    allowed_vehicle_types: ['orbital-rocket', 'satellite', 'probe'],
  },
  manned: {
    label: 'Crewed Orbital Flight',
    required_delta_v_m_s: 3400,
    payload_mass_kg: 1200,
    crew_required: 2,
    allowed_vehicle_types: ['capsule'],
  },
  colonial: {
    label: 'Deep-Space Colonial Flight',
    required_delta_v_m_s: 5200,
    payload_mass_kg: 2500,
    crew_required: 0,
    allowed_vehicle_types: ['lander'],
  },
});

const VEHICLE_PERFORMANCE = Object.freeze({
  'sounding-rocket': {
    vehicle_class: 'suborbital',
    dry_mass_kg: 1200,
    propellant_mass_kg: 9800,
    payload_capacity_kg: 150,
    delta_v_budget_m_s: 2100,
    crew_capacity: 0,
  },
  'orbital-rocket': {
    vehicle_class: 'orbital',
    dry_mass_kg: 12000,
    propellant_mass_kg: 130000,
    payload_capacity_kg: 4500,
    delta_v_budget_m_s: 9450,
    crew_capacity: 0,
  },
  satellite: {
    vehicle_class: 'orbital-payload',
    dry_mass_kg: 800,
    propellant_mass_kg: 600,
    payload_capacity_kg: 700,
    delta_v_budget_m_s: 3800,
    crew_capacity: 0,
  },
  capsule: {
    vehicle_class: 'crewed',
    dry_mass_kg: 3500,
    propellant_mass_kg: 1500,
    payload_capacity_kg: 1500,
    delta_v_budget_m_s: 4200,
    crew_capacity: 3,
  },
  probe: {
    vehicle_class: 'deep-space',
    dry_mass_kg: 1000,
    propellant_mass_kg: 1400,
    payload_capacity_kg: 900,
    delta_v_budget_m_s: 4200,
    crew_capacity: 0,
  },
  lander: {
    vehicle_class: 'deep-space',
    dry_mass_kg: 6000,
    propellant_mass_kg: 11000,
    payload_capacity_kg: 3000,
    delta_v_budget_m_s: 5800,
    crew_capacity: 2,
  },
});

const PLANE_CHANGE_MPS_PER_DEG = 20;
const MIN_DELTA_V_MARGIN_PCT = 5;

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

function formatNumber(value) {
  return Math.round(Number(value) || 0).toLocaleString('en-US');
}

function vehiclePerformance(vehicle) {
  const profile = VEHICLE_PERFORMANCE[vehicle?.type] || null;
  const numberField = (field) => {
    const override = optionalNumber(vehicle?.[field]);
    return override === null ? profile?.[field] ?? null : override;
  };
  const classOverride = String(vehicle?.vehicle_class || '').trim();

  return {
    vehicle_class: classOverride || profile?.vehicle_class || null,
    dry_mass_kg: numberField('dry_mass_kg'),
    propellant_mass_kg: numberField('propellant_mass_kg'),
    payload_capacity_kg: numberField('payload_capacity_kg'),
    delta_v_budget_m_s: numberField('delta_v_budget_m_s'),
    crew_capacity: numberField('crew_capacity'),
  };
}

function evaluateMissionFeasibility({
  agency,
  vehicle,
  missionType,
  targetInclinationDeg,
  launchSiteLat,
} = {}) {
  const profile = MISSION_PROFILES[missionType] || null;
  const performance = vehiclePerformance(vehicle);
  const siteLat = Math.abs(Number(launchSiteLat ?? agency?.launch_site_lat ?? 0));
  const requestedInclination = optionalNumber(targetInclinationDeg);
  const targetInclination = requestedInclination === null ? siteLat : requestedInclination;
  const blockers = [];
  const warnings = [];

  if (!profile) {
    blockers.push({
      code: 'UNKNOWN_MISSION_TYPE',
      message: `Unknown mission type: ${missionType}`,
    });
  }

  if (!vehicle) {
    blockers.push({
      code: 'VEHICLE_REQUIRED',
      message: 'A vehicle is required to evaluate mission feasibility',
    });
  } else if (!performance.delta_v_budget_m_s && !performance.payload_capacity_kg) {
    blockers.push({
      code: 'MISSING_PERFORMANCE_PROFILE',
      message: `Vehicle type ${vehicle.type || 'unknown'} has no performance profile`,
    });
  }

  if (profile && vehicle && !profile.allowed_vehicle_types.includes(vehicle.type)) {
    blockers.push({
      code: 'VEHICLE_CLASS_MISMATCH',
      message: `${vehicle.type || 'Vehicle'} is not cleared for ${missionType} missions (allowed: ${profile.allowed_vehicle_types.join(', ')})`,
    });
  }

  if (targetInclination < 0 || targetInclination > 180) {
    blockers.push({
      code: 'INVALID_TARGET_INCLINATION',
      message: 'Target inclination must be between 0 and 180 degrees',
    });
  } else if (targetInclination < siteLat) {
    blockers.push({
      code: 'TARGET_BELOW_SITE_LATITUDE',
      message: `Target inclination ${round(targetInclination, 2)}° is below the launch site latitude ${round(siteLat, 2)}° and requires a plane change`,
    });
  }

  const planeChangeDeg = Math.max(0, targetInclination - siteLat);
  const inclinationPenaltyMps = round(planeChangeDeg * PLANE_CHANGE_MPS_PER_DEG, 1);
  const deltaVRequired = round(
    (profile?.required_delta_v_m_s || 0) + inclinationPenaltyMps,
    1,
  );
  const deltaVAvailable = performance.delta_v_budget_m_s;
  const deltaVMargin = deltaVAvailable === null ? null : round(deltaVAvailable - deltaVRequired, 1);
  const deltaVMarginPct = deltaVMargin === null || deltaVRequired <= 0
    ? null
    : round((deltaVMargin / deltaVRequired) * 100, 1);

  if (deltaVMargin !== null && deltaVMargin < 0) {
    blockers.push({
      code: 'DELTA_V_DEFICIT',
      message: `Delta-v short by ${formatNumber(Math.abs(deltaVMargin))} m/s (${formatNumber(deltaVAvailable)} available / ${formatNumber(deltaVRequired)} required)`,
    });
  } else if (deltaVMarginPct !== null && deltaVMarginPct < MIN_DELTA_V_MARGIN_PCT) {
    warnings.push({
      code: 'LOW_DELTA_V_MARGIN',
      message: `Delta-v margin is only ${deltaVMarginPct}% (${formatNumber(deltaVMargin)} m/s)`,
    });
  }

  const payloadRequired = profile?.payload_mass_kg || 0;
  const payloadCapacity = performance.payload_capacity_kg;
  const payloadMargin = payloadCapacity === null ? null : round(payloadCapacity - payloadRequired, 1);
  if (payloadMargin !== null && payloadMargin < 0) {
    blockers.push({
      code: 'PAYLOAD_OVERLOAD',
      message: `Payload overload by ${formatNumber(Math.abs(payloadMargin))} kg (${formatNumber(payloadCapacity)} capacity / ${formatNumber(payloadRequired)} required)`,
    });
  }

  const estimatedCost = calculateMissionCost({
    missionType,
    deltaVRequiredMps: deltaVRequired,
    payloadRequiredKg: payloadRequired,
  });
  const estimatedDuration = calculateMissionDuration({
    missionType,
    deltaVRequiredMps: deltaVRequired,
    payloadRequiredKg: payloadRequired,
  });
  const missionFunding = estimatedCost.funding_usd;
  const fundingAvailable = Number(agency?.funding_usd ?? 0);

  const crewRequired = profile?.crew_required || 0;
  const crewCapacity = performance.crew_capacity;
  const crewMargin = crewCapacity === null ? null : Math.round(crewCapacity - crewRequired);
  if (crewMargin !== null && crewMargin < 0) {
    blockers.push({
      code: 'CREW_SHORTFALL',
      message: `Crew capacity short by ${Math.abs(crewMargin)} (${crewCapacity} available / ${crewRequired} required)`,
    });
  }

  const fundingMargin = fundingAvailable - missionFunding;
  if (fundingMargin < 0) {
    blockers.push({
      code: 'INSUFFICIENT_FUNDING',
      message: `Insufficient funding: $${formatNumber(missionFunding)} required, $${formatNumber(fundingAvailable)} available`,
    });
  }

  return {
    feasible: blockers.length === 0,
    mission_type: missionType,
    mission_label: profile?.label || null,
    vehicle_id: vehicle?.id || null,
    vehicle_type: vehicle?.type || null,
    vehicle_class: performance.vehicle_class,
    launch_site_lat: round(siteLat, 3),
    target_inclination_deg: round(targetInclination, 3),
    inclination_penalty_m_s: inclinationPenaltyMps,
    requirements: {
      delta_v_m_s: deltaVRequired,
      payload_mass_kg: payloadRequired,
      crew_required: crewRequired,
      allowed_vehicle_types: profile ? [...profile.allowed_vehicle_types] : [],
    },
    performance: {
      delta_v_budget_m_s: deltaVAvailable,
      payload_capacity_kg: payloadCapacity,
      crew_capacity: crewCapacity,
      dry_mass_kg: performance.dry_mass_kg,
      propellant_mass_kg: performance.propellant_mass_kg,
    },
    delta_v_available_m_s: deltaVAvailable,
    delta_v_required_m_s: deltaVRequired,
    delta_v_margin_m_s: deltaVMargin,
    delta_v_margin_pct: deltaVMarginPct,
    payload_capacity_kg: payloadCapacity,
    payload_required_kg: payloadRequired,
    payload_margin_kg: payloadMargin,
    crew_capacity: crewCapacity,
    crew_required: crewRequired,
    crew_margin: crewMargin,
    estimated_cost: estimatedCost,
    estimated_duration: estimatedDuration,
    funding_required_usd: missionFunding,
    funding_available_usd: fundingAvailable,
    funding_margin_usd: fundingMargin,
    blockers,
    warnings,
  };
}

function feasibilityErrorMessage(feasibility) {
  if (!feasibility) return 'Mission feasibility could not be evaluated';
  if (feasibility.feasible) return 'Mission is feasible';
  const messages = (feasibility.blockers || []).map((blocker) => blocker.message);
  return `Mission infeasible: ${messages.slice(0, 3).join('; ')}`;
}

module.exports = {
  MISSION_PROFILES,
  VEHICLE_PERFORMANCE,
  PLANE_CHANGE_MPS_PER_DEG,
  MIN_DELTA_V_MARGIN_PCT,
  vehiclePerformance,
  evaluateMissionFeasibility,
  feasibilityErrorMessage,
};
