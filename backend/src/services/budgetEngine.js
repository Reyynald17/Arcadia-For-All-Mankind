const {
  gameDateAt,
  gameDateToRealDate,
  loadActiveSeason,
} = require('./gameClock');
const { recordAuditEvent } = require('./auditLog');

const POLICY_VERSION = 1;

const BUDGET_POLICY = Object.freeze({
  appropriation: Object.freeze({
    base_usd: 4000000,
    ipi_rate_usd: 40000,
    si_rate_usd: 20000,
    alignment_multiplier: Object.freeze({
      WESTERN: 1.15,
      EASTERN: 1.15,
      INDEPENDENT: 1,
    }),
  }),
  operating: Object.freeze({
    headquarters_usd: 1200000,
    engineer_salary_usd: 60000,
  }),
  vehicle_upkeep_usd: Object.freeze({
    'sounding-rocket': 60000,
    'orbital-rocket': 240000,
    satellite: 120000,
    capsule: 300000,
    probe: 180000,
    lander: 420000,
  }),
  default_vehicle_upkeep_usd: 100000,
  excluded_vehicle_statuses: Object.freeze(['manufacturing']),
});

function clampPercent(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, parsed));
}

function roundUsd(value) {
  return Math.round(Number(value) / 10000) * 10000;
}

function migrationMissing(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return (
    code === '42P01' ||
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    /does not exist/i.test(message) ||
    /Could not find the table/i.test(message) ||
    /Could not find the function/i.test(message)
  );
}

function calculateAnnualAppropriation(agency) {
  const policy = BUDGET_POLICY.appropriation;
  const alignment = String(agency?.alignment || 'INDEPENDENT').toUpperCase();
  const alignmentMultiplier = policy.alignment_multiplier[alignment] ?? 1;
  const ipi = clampPercent(agency?.ipi, 0);
  const si = clampPercent(agency?.si, 0);

  const ipiComponent = Math.round(ipi * policy.ipi_rate_usd);
  const siComponent = Math.round(si * policy.si_rate_usd);
  const subtotal = policy.base_usd + ipiComponent + siComponent;

  return {
    base_usd: policy.base_usd,
    ipi,
    ipi_component_usd: ipiComponent,
    si,
    si_component_usd: siComponent,
    alignment,
    alignment_multiplier: alignmentMultiplier,
    total_usd: roundUsd(subtotal * alignmentMultiplier),
  };
}

function calculateOperatingCost(agency) {
  const policy = BUDGET_POLICY.operating;
  const engineers = Math.max(0, Math.floor(Number(agency?.total_engineers) || 0));
  const personnelUsd = engineers * policy.engineer_salary_usd;

  return {
    headquarters_usd: policy.headquarters_usd,
    engineers,
    engineer_salary_usd: policy.engineer_salary_usd,
    personnel_usd: personnelUsd,
    total_usd: policy.headquarters_usd + personnelUsd,
  };
}

function calculateVehicleUpkeep(vehicles = []) {
  const excluded = new Set(BUDGET_POLICY.excluded_vehicle_statuses);
  const counts = new Map();

  for (const vehicle of vehicles || []) {
    const status = String(vehicle?.status || '').toLowerCase();
    if (excluded.has(status)) continue;
    const type = String(vehicle?.type || 'unknown');
    counts.set(type, (counts.get(type) || 0) + 1);
  }

  const lines = [...counts.entries()]
    .map(([type, count]) => {
      const unitUsd = BUDGET_POLICY.vehicle_upkeep_usd[type]
        ?? BUDGET_POLICY.default_vehicle_upkeep_usd;
      return {
        type,
        count,
        unit_usd: unitUsd,
        total_usd: unitUsd * count,
      };
    })
    .sort((a, b) => b.total_usd - a.total_usd);

  return {
    vehicle_count: lines.reduce((sum, line) => sum + line.count, 0),
    lines,
    total_usd: lines.reduce((sum, line) => sum + line.total_usd, 0),
  };
}

function calculateAnnualBudget(agency, vehicles = []) {
  const appropriation = calculateAnnualAppropriation(agency);
  const operating = calculateOperatingCost(agency);
  const upkeep = calculateVehicleUpkeep(vehicles);
  const totalCostUsd = operating.total_usd + upkeep.total_usd;

  return {
    policy_version: POLICY_VERSION,
    funding_usd: Number(agency?.funding_usd || 0),
    appropriation,
    operating,
    upkeep,
    total_cost_usd: totalCostUsd,
    net_usd: appropriation.total_usd - totalCostUsd,
  };
}

function budgetBoundaryForYear(season, cycleYear) {
  const year = Number(cycleYear);
  if (!Number.isInteger(year)) throw new Error('cycleYear must be an integer');

  const gameDate = new Date(Date.UTC(year, 0, 1));
  const executeAt = gameDateToRealDate(season, gameDate);

  return {
    cycle_year: year,
    game_date: gameDate.toISOString().slice(0, 10),
    execute_at: executeAt.toISOString(),
  };
}

function nextBudgetBoundary(season, now = new Date()) {
  const gameNow = gameDateAt(season, now);
  return budgetBoundaryForYear(season, gameNow.getUTCFullYear() + 1);
}

async function loadSeasonForAgency(supabase, agency) {
  if (agency?.season_id) {
    const { data, error } = await supabase
      .from('seasons')
      .select('*')
      .eq('id', agency.season_id)
      .maybeSingle();
    if (!error && data) return data;
  }
  return loadActiveSeason(supabase);
}

async function insertBudgetReviewEvent(supabase, {
  agencyId,
  season,
  boundary,
}) {
  const { data, error } = await supabase
    .from('scheduled_events')
    .insert([{
      season_id: season.id,
      agency_id: agencyId,
      event_type: 'BUDGET_REVIEW',
      reference_id: `budget:${agencyId}:${boundary.cycle_year}`,
      payload: {
        cycle_year: boundary.cycle_year,
        game_date: boundary.game_date,
        policy_version: POLICY_VERSION,
      },
      execute_at: boundary.execute_at,
      status: 'PENDING',
    }])
    .select()
    .single();

  if (error) throw new Error(`budget schedule: ${error.message}`);
  return data;
}

async function ensureBudgetReviewScheduled(supabase, agency, options = {}) {
  if (!agency?.id) throw new Error('Agency is required to schedule a budget review');
  if (agency.controller_type && agency.controller_type !== 'player') return null;
  if (agency.is_active === false) return null;

  const now = options.now || new Date();
  const season = options.season || await loadSeasonForAgency(supabase, agency);

  const { data: existing, error } = await supabase
    .from('scheduled_events')
    .select('*')
    .eq('agency_id', agency.id)
    .eq('event_type', 'BUDGET_REVIEW')
    .eq('status', 'PENDING')
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`budget schedule lookup: ${error.message}`);
  if (existing) return existing;

  const boundary = nextBudgetBoundary(season, now);
  return insertBudgetReviewEvent(supabase, {
    agencyId: agency.id,
    season,
    boundary,
  });
}

async function ensureBudgetSchedules(supabase, options = {}) {
  const now = options.now || new Date();
  const season = options.season || await loadActiveSeason(supabase);

  const { data: agencies, error: agencyError } = await supabase
    .from('agencies')
    .select('*')
    .eq('controller_type', 'player');

  if (agencyError) throw new Error(`budget agencies: ${agencyError.message}`);

  const { data: pending, error: pendingError } = await supabase
    .from('scheduled_events')
    .select('*')
    .eq('event_type', 'BUDGET_REVIEW')
    .eq('status', 'PENDING');

  if (pendingError) throw new Error(`budget pending events: ${pendingError.message}`);

  const covered = new Set((pending || []).map((event) => event.agency_id));
  const scheduled = [];
  const errors = [];

  for (const agency of agencies || []) {
    if (agency.is_active === false || covered.has(agency.id)) continue;
    try {
      const event = await ensureBudgetReviewScheduled(supabase, agency, { season, now });
      if (event) scheduled.push(event);
    } catch (error) {
      errors.push({ agency_id: agency.id, message: error.message });
    }
  }

  return {
    season_id: season.id,
    scheduled: scheduled.length,
    skipped: (agencies || []).length - scheduled.length - errors.length,
    errors,
  };
}

async function handleBudgetReview(supabase, event, options = {}) {
  const now = options.now || new Date();
  const agencyId = event?.agency_id || event?.payload?.agency_id;
  if (!agencyId) throw new Error('BUDGET_REVIEW is missing agency_id');

  const { data: agency, error: agencyError } = await supabase
    .from('agencies')
    .select('*')
    .eq('id', agencyId)
    .maybeSingle();

  if (agencyError) throw new Error(`budget agency: ${agencyError.message}`);
  if (!agency) return { status: 'skipped', reason: 'AGENCY_NOT_FOUND', agency_id: agencyId };
  if (agency.controller_type && agency.controller_type !== 'player') {
    return { status: 'skipped', reason: 'NPC_AGENCY', agency_id: agencyId };
  }

  const season = event.season_id
    ? (await supabase.from('seasons').select('*').eq('id', event.season_id).maybeSingle()).data
    : null;
  const activeSeason = season || await loadSeasonForAgency(supabase, agency);

  let cycleYear = Number(event?.payload?.cycle_year);
  if (!Number.isInteger(cycleYear)) {
    const reference = event?.execute_at ? new Date(event.execute_at) : now;
    cycleYear = gameDateAt(activeSeason, reference).getUTCFullYear();
  }

  const { data: vehicles, error: vehicleError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('agency_id', agencyId);

  if (vehicleError) throw new Error(`budget vehicles: ${vehicleError.message}`);

  const budget = calculateAnnualBudget(agency, vehicles || []);
  const gameDate = event?.payload?.game_date || `${cycleYear}-01-01`;

  const { data: settlement, error: rpcError } = await supabase.rpc('settle_annual_budget', {
    p_agency_id: agencyId,
    p_season_id: activeSeason.id,
    p_cycle_year: cycleYear,
    p_game_date: gameDate,
    p_appropriation_usd: budget.appropriation.total_usd,
    p_operating_cost_usd: budget.operating.total_usd,
    p_upkeep_usd: budget.upkeep.total_usd,
    p_details: {
      policy_version: POLICY_VERSION,
      appropriation: budget.appropriation,
      operating: budget.operating,
      upkeep: budget.upkeep,
    },
    p_settled_at: now.toISOString(),
  });

  if (rpcError) {
    if (migrationMissing(rpcError)) {
      throw new Error('Budget migration 014 is not applied yet');
    }
    throw new Error(`annual budget settlement: ${rpcError.message}`);
  }

  if (settlement?.already_applied) {
    await ensureBudgetReviewScheduled(supabase, agency, { season: activeSeason, now });
    return {
      status: 'already_settled',
      agency_id: agencyId,
      cycle_year: cycleYear,
    };
  }

  const logData = {
    cycle_year: cycleYear,
    game_date: gameDate,
    policy_version: POLICY_VERSION,
    appropriation_usd: budget.appropriation.total_usd,
    operating_cost_usd: budget.operating.total_usd,
    upkeep_usd: budget.upkeep.total_usd,
    total_cost_usd: budget.total_cost_usd,
    net_usd: settlement?.net_usd ?? budget.net_usd,
    funding_before_usd: settlement?.funding_before_usd ?? null,
    funding_after_usd: settlement?.funding_after_usd ?? null,
    unpaid_usd: settlement?.unpaid_usd ?? 0,
    appropriation: budget.appropriation,
    operating: budget.operating,
    upkeep: budget.upkeep,
  };

  const { error: logError } = await supabase
    .from('logs')
    .insert([{
      agency_id: agencyId,
      event_type: settlement?.unpaid_usd > 0 ? 'BUDGET_DEFICIT' : 'BUDGET_REVIEW',
      description: `Annual budget FY${cycleYear} settled: net ${budget.net_usd >= 0 ? '+' : '-'}$${Math.abs(budget.net_usd).toLocaleString('en-US')}`,
      data: logData,
    }]);

  if (logError) {
    console.error(`budget log: ${logError.message}`);
  }

  await recordAuditEvent(supabase, {
    actorType: 'system',
    actorId: 'budget_engine',
    seasonId: activeSeason.id,
    agencyId,
    action: 'ANNUAL_BUDGET_SETTLED',
    entityType: 'agency',
    entityId: agencyId,
    beforeData: { funding_usd: settlement?.funding_before_usd ?? null },
    afterData: { funding_usd: settlement?.funding_after_usd ?? null },
    deltaData: { funding_usd: settlement?.net_usd ?? budget.net_usd },
    metadata: {
      cycle_year: cycleYear,
      game_date: gameDate,
      appropriation_usd: budget.appropriation.total_usd,
      operating_cost_usd: budget.operating.total_usd,
      upkeep_usd: budget.upkeep.total_usd,
      unpaid_usd: settlement?.unpaid_usd ?? 0,
      status: settlement?.status || null,
    },
  });

  await ensureBudgetReviewScheduled(supabase, agency, { season: activeSeason, now });

  return {
    status: settlement?.status || 'APPLIED',
    agency_id: agencyId,
    cycle_year: cycleYear,
    appropriation_usd: budget.appropriation.total_usd,
    operating_cost_usd: budget.operating.total_usd,
    upkeep_usd: budget.upkeep.total_usd,
    total_cost_usd: budget.total_cost_usd,
    net_usd: settlement?.net_usd ?? budget.net_usd,
    funding_before_usd: settlement?.funding_before_usd ?? null,
    funding_after_usd: settlement?.funding_after_usd ?? null,
    unpaid_usd: settlement?.unpaid_usd ?? 0,
  };
}

async function getBudgetOverview(supabase, agency, options = {}) {
  const now = options.now || new Date();

  let vehicleRows = options.vehicles;
  let vehicleError = null;
  if (!vehicleRows) {
    const { data, error } = await supabase
      .from('vehicles')
      .select('*')
      .eq('agency_id', agency.id);
    if (error) vehicleError = error.message;
    vehicleRows = data || [];
  }

  const projection = calculateAnnualBudget(agency, vehicleRows);
  let next = null;
  let seasonError = null;
  try {
    const season = options.season || await loadSeasonForAgency(supabase, agency);
    next = nextBudgetBoundary(season, now);
  } catch (error) {
    seasonError = error.message;
  }

  let history = [];
  let historyMigrationRequired = false;
  let historyError = null;
  try {
    const { data: cycles, error: cyclesError } = await supabase
      .from('agency_budget_cycles')
      .select('*')
      .eq('agency_id', agency.id)
      .order('settled_at', { ascending: false })
      .limit(6);

    if (cyclesError) {
      if (migrationMissing(cyclesError)) {
        historyMigrationRequired = true;
      } else {
        historyError = cyclesError.message;
      }
    } else {
      history = cycles || [];
    }
  } catch (error) {
    historyError = error.message || String(error);
  }

  return {
    ...projection,
    next_review_at: next?.execute_at || null,
    next_review_game_date: next?.game_date || null,
    next_cycle_year: next?.cycle_year || null,
    history,
    history_migration_required: historyMigrationRequired,
    history_error: historyError,
    season_error: seasonError,
    vehicle_error: vehicleError,
  };
}

module.exports = {
  POLICY_VERSION,
  BUDGET_POLICY,
  calculateAnnualAppropriation,
  calculateOperatingCost,
  calculateVehicleUpkeep,
  calculateAnnualBudget,
  budgetBoundaryForYear,
  nextBudgetBoundary,
  loadSeasonForAgency,
  ensureBudgetReviewScheduled,
  ensureBudgetSchedules,
  handleBudgetReview,
  getBudgetOverview,
  migrationMissing,
};
