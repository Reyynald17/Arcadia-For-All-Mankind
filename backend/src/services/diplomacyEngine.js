const { randomUUID } = require('node:crypto');
const { DIPLOMACY_CONFIG, getPublicPolicy } = require('../config/diplomacyConfig');
const {
  loadActiveSeason,
  gameDaysToRealMs,
  realMsToGameDays,
  gameDateAt,
  formatGameDate,
  DEFAULT_TIME_SCALE,
} = require('./gameClock');
const { hashSeed, createSeededRng } = require('./seededRng');

const ERROR_STATUS = {
  AUTH_REQUIRED: 401,
  FORBIDDEN_AGENCY: 403,
  FORBIDDEN_PROPOSAL: 403,
  FORBIDDEN_AGREEMENT: 403,
  AGENCY_NOT_FOUND: 404,
  TARGET_NOT_FOUND: 404,
  PROPOSAL_NOT_FOUND: 404,
  AGREEMENT_NOT_FOUND: 404,
  RELATION_NOT_FOUND: 404,
  AGENCY_INACTIVE: 409,
  TARGET_INACTIVE: 409,
  SEASON_MISMATCH: 409,
  DUPLICATE_PROPOSAL: 409,
  DUPLICATE_AGREEMENT: 409,
  COOLDOWN: 409,
  MAX_PROPOSALS: 409,
  TARGET_MAX_PROPOSALS: 409,
  COUNTER_LIMIT: 409,
  PROPOSAL_NOT_PENDING: 409,
  PROPOSAL_EXPIRED: 410,
  AGREEMENT_NOT_ACTIVE: 409,
  WESTERN_SATURATED: 409,
  EASTERN_SATURATED: 409,
  SELF_PROPOSAL: 400,
  UNSUPPORTED_AGREEMENT: 400,
  INVALID_DURATION: 400,
  INVALID_ACTION: 400,
  NOTE_TOO_LONG: 400,
  INSUFFICIENT_FUNDING: 400,
  RATE_LIMITED: 429,
};

class DiplomacyError extends Error {
  constructor(code, message, details = null, status = null) {
    super(message || code);
    this.name = 'DiplomacyError';
    this.code = code;
    this.details = details || {};
    this.status = status || ERROR_STATUS[code] || 400;
  }
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function nowDate(now) {
  return toDate(now) || new Date();
}

function iso(value) {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

function seasonMultiplier(season) {
  const value = Number(season?.time_scale_multiplier);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIME_SCALE;
}

function gameDaysToMs(gameDays, season) {
  return gameDaysToRealMs(gameDays, seasonMultiplier(season));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeText(value, maxLength = DIPLOMACY_CONFIG.notes.maxLength) {
  if (value === null || value === undefined) return '';
  const cleaned = String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

function normalizedNote(value, config) {
  if (value === null || value === undefined || value === '') return '';
  const maxLength = Number(config.notes.maxLength);
  const cleaned = String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length > maxLength) {
    throw new DiplomacyError('NOTE_TOO_LONG', `Note must be at most ${maxLength} characters.`);
  }
  return cleaned;
}

function normalizePair(firstAgencyId, secondAgencyId) {
  const first = String(firstAgencyId);
  const second = String(secondAgencyId);
  return first < second
    ? { lowId: first, highId: second }
    : { lowId: second, highId: first };
}

function isCrossBloc(blocA, blocB) {
  return (
    (blocA === 'western' && blocB === 'eastern')
    || (blocA === 'eastern' && blocB === 'western')
  );
}

function sameBloc(blocA, blocB) {
  return Boolean(blocA) && blocA === blocB;
}

function saturationThreshold(blocSize, ratio) {
  const size = Math.max(0, Number(blocSize) || 0);
  const safeRatio = Math.max(0, Number(ratio) || 0);
  return Math.ceil(safeRatio * size);
}

function relationStatusForScore(score, config) {
  const value = Number(score) || 0;
  if (value >= config.relation.alliedThreshold) return 'allied';
  if (value >= config.relation.cooperativeThreshold) return 'cooperative';
  return 'neutral';
}

function acceptanceBand(score, config) {
  const value = Number(score) || 0;
  if (value >= config.acceptance.highThreshold) return 'high';
  if (value >= config.acceptance.mediumThreshold) return 'medium';
  return 'low';
}

function publicAgency(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    code: row.code || null,
    country: row.country || null,
    bloc: row.bloc,
    alignment: row.alignment,
    controller_type: row.controller_type,
    is_active: Boolean(row.is_active),
  };
}

function publicEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    event_type: row.event_type,
    description: row.description || '',
    proposal_id: row.proposal_id || null,
    agreement_id: row.agreement_id || null,
    data: row.data || {},
    created_at: row.created_at,
  };
}

function activeAgreement(row, now) {
  if (!row || row.status !== 'active') return false;
  const endsAt = toDate(row.ends_at);
  return Boolean(endsAt && endsAt.getTime() > now.getTime());
}

function livePendingProposal(row, now) {
  if (!row || row.status !== 'pending') return false;
  const expiresAt = toDate(row.expires_at);
  return Boolean(expiresAt && expiresAt.getTime() > now.getTime());
}

async function maybeSingle(query) {
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function loadSeason(supabase, season) {
  return season || loadActiveSeason(supabase);
}

async function loadAgency(supabase, agencyId) {
  return maybeSingle(
    supabase.from('agencies').select('*').eq('id', agencyId),
  );
}

async function loadAgenciesByIds(supabase, agencyIds) {
  const ids = [...new Set((agencyIds || []).filter(Boolean).map(String))];
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from('agencies').select('*').in('id', ids);
  if (error) throw new Error(`agencies lookup: ${error.message}`);
  return data || [];
}

async function loadRelation(supabase, firstAgencyId, secondAgencyId) {
  const { lowId, highId } = normalizePair(firstAgencyId, secondAgencyId);
  return maybeSingle(
    supabase
      .from('agency_relations')
      .select('*')
      .eq('agency_low_id', lowId)
      .eq('agency_high_id', highId),
  );
}

async function loadAgreementsForAgency(supabase, agencyId) {
  const [lowResult, highResult] = await Promise.all([
    supabase.from('agency_agreements').select('*').eq('party_low_id', agencyId),
    supabase.from('agency_agreements').select('*').eq('party_high_id', agencyId),
  ]);
  if (lowResult.error) throw new Error(lowResult.error.message);
  if (highResult.error) throw new Error(highResult.error.message);
  const byId = new Map();
  for (const row of [...(lowResult.data || []), ...(highResult.data || [])]) {
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

async function loadProposalsForAgency(supabase, agencyId) {
  const [incoming, outgoing] = await Promise.all([
    supabase.from('diplomatic_proposals').select('*').eq('to_agency_id', agencyId),
    supabase.from('diplomatic_proposals').select('*').eq('from_agency_id', agencyId),
  ]);
  if (incoming.error) throw new Error(incoming.error.message);
  if (outgoing.error) throw new Error(outgoing.error.message);
  const byId = new Map();
  for (const row of [...(incoming.data || []), ...(outgoing.data || [])]) {
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

async function loadEventsForAgency(supabase, agencyId) {
  const [asActor, asCounterpart] = await Promise.all([
    supabase.from('diplomatic_events').select('*').eq('actor_agency_id', agencyId),
    supabase.from('diplomatic_events').select('*').eq('counterpart_agency_id', agencyId),
  ]);
  if (asActor.error) throw new Error(asActor.error.message);
  if (asCounterpart.error) throw new Error(asCounterpart.error.message);
  const byId = new Map();
  for (const row of [...(asActor.data || []), ...(asCounterpart.data || [])]) {
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

function counterpartIdFor(agreement, agencyId) {
  return agreement.party_low_id === agencyId
    ? agreement.party_high_id
    : agreement.party_low_id;
}

function counterpartIdForProposal(proposal, agencyId) {
  return proposal.from_agency_id === agencyId
    ? proposal.to_agency_id
    : proposal.from_agency_id;
}

async function logDiplomaticEvent(supabase, entry) {
  const { error } = await supabase.from('diplomatic_events').insert([{
    season_id: entry.season_id || null,
    actor_agency_id: entry.actor_agency_id || null,
    counterpart_agency_id: entry.counterpart_agency_id || null,
    event_type: entry.event_type,
    proposal_id: entry.proposal_id || null,
    agreement_id: entry.agreement_id || null,
    description: entry.description || '',
    data: entry.data || {},
  }]);
  if (error) throw new Error(`diplomatic event: ${error.message}`);
}

async function scheduleEvent(supabase, entry) {
  const { error } = await supabase.from('scheduled_events').insert([{
    season_id: entry.season_id || null,
    agency_id: entry.agency_id || null,
    event_type: entry.event_type,
    reference_id: entry.reference_id,
    payload: entry.payload || {},
    execute_at: entry.execute_at,
    status: 'PENDING',
  }]);
  if (error) throw new Error(`scheduled event: ${error.message}`);
}

async function getBlocSize(supabase, bloc, options = {}) {
  let query = supabase
    .from('agencies')
    .select('id')
    .eq('bloc', bloc)
    .eq('is_active', true);
  if (options.seasonId) query = query.eq('season_id', options.seasonId);
  const { data, error } = await query;
  if (error) throw new Error(`bloc size: ${error.message}`);
  return (data || []).length;
}

async function getCooperationCount(supabase, agencyId, bloc, options = {}) {
  const now = nowDate(options.now);
  const seasonId = options.seasonId || null;
  const agreements = (await loadAgreementsForAgency(supabase, agencyId))
    .filter((agreement) => (
      activeAgreement(agreement, now)
      && agreement.agreement_type === 'cooperation'
    ));

  const counterpartIds = [...new Set(
    agreements.map((agreement) => counterpartIdFor(agreement, agencyId)),
  )];
  if (counterpartIds.length === 0) return 0;

  const agencies = await loadAgenciesByIds(supabase, counterpartIds);
  return agencies.filter((agency) => (
    agency.is_active
    && agency.bloc === bloc
    && (!seasonId || agency.season_id === seasonId)
  )).length;
}

async function getSaturation(supabase, agencyId, bloc, options = {}) {
  const config = options.config || DIPLOMACY_CONFIG;
  const now = nowDate(options.now);
  const agency = options.agency || await loadAgency(supabase, agencyId);
  if (!agency) throw new DiplomacyError('AGENCY_NOT_FOUND', 'Agency not found.');
  const seasonId = options.season?.id || agency.season_id || null;
  const blocAgencyCount = await getBlocSize(supabase, bloc, { seasonId });
  const counterpartCount = await getCooperationCount(supabase, agencyId, bloc, {
    now,
    seasonId,
  });
  const threshold = saturationThreshold(blocAgencyCount, config.saturationRatio);
  const applicable = agency.bloc === 'neutral' && (bloc === 'western' || bloc === 'eastern');
  const isSaturated = applicable
    && blocAgencyCount > 0
    && counterpartCount > 0
    && counterpartCount >= threshold;
  const evaluatedAt = now.toISOString();

  if (applicable && options.persist !== false) {
    const { error } = await supabase.from('agency_bloc_saturation').upsert([{
      agency_id: agencyId,
      bloc,
      counterpart_count: counterpartCount,
      bloc_agency_count: blocAgencyCount,
      threshold,
      is_saturated: isSaturated,
      evaluated_at: evaluatedAt,
    }], { onConflict: 'agency_id,bloc' });
    if (error) throw new Error(`saturation cache: ${error.message}`);
  }

  return {
    bloc,
    applicable,
    counterpartCount,
    blocAgencyCount,
    threshold,
    isSaturated,
    evaluatedAt,
  };
}

async function refreshSaturationForAgency(supabase, agencyId, options = {}) {
  const agency = options.agency || await loadAgency(supabase, agencyId);
  if (!agency || agency.bloc !== 'neutral') return [];
  return Promise.all(['western', 'eastern'].map((bloc) => (
    getSaturation(supabase, agencyId, bloc, {
      ...options,
      agency,
      persist: options.persist !== false,
    })
  )));
}

async function refreshAllNeutralSaturation(supabase, options = {}) {
  const config = options.config || DIPLOMACY_CONFIG;
  const season = await loadSeason(supabase, options.season);
  const { data, error } = await supabase
    .from('agencies')
    .select('*')
    .eq('season_id', season.id)
    .eq('bloc', 'neutral')
    .eq('is_active', true);
  if (error) throw new Error(error.message);
  for (const agency of data || []) {
    await refreshSaturationForAgency(supabase, agency.id, {
      ...options,
      config,
      season,
      agency,
      persist: true,
    });
  }
  return (data || []).length;
}

async function saturationChecksForPair(supabase, fromAgency, toAgency, options = {}) {
  const config = options.config || DIPLOMACY_CONFIG;
  const now = nowDate(options.now);
  const checks = [];

  if (fromAgency.bloc === 'neutral' && (toAgency.bloc === 'western' || toAgency.bloc === 'eastern')) {
    checks.push(await getSaturation(supabase, fromAgency.id, toAgency.bloc, {
      config,
      now,
      season: options.season,
      agency: fromAgency,
      persist: false,
    }));
  }

  if (toAgency.bloc === 'neutral' && (fromAgency.bloc === 'western' || fromAgency.bloc === 'eastern')) {
    checks.push(await getSaturation(supabase, toAgency.id, fromAgency.bloc, {
      config,
      now,
      season: options.season,
      agency: toAgency,
      persist: false,
    }));
  }

  return checks;
}

function saturationErrorFromChecks(checks) {
  const saturated = checks.find((check) => check.isSaturated);
  if (!saturated) return null;
  const code = `${saturated.bloc.toUpperCase()}_SATURATED`;
  return new DiplomacyError(
    code,
    `${saturated.bloc} bloc cooperation capacity is saturated for this agency.`,
    saturated,
  );
}

async function countPendingOutgoing(supabase, agencyId, now) {
  const { data, error } = await supabase
    .from('diplomatic_proposals')
    .select('*')
    .eq('from_agency_id', agencyId)
    .eq('status', 'pending');
  if (error) throw new Error(error.message);
  return (data || []).filter((proposal) => livePendingProposal(proposal, now)).length;
}

async function countPendingIncoming(supabase, agencyId, now) {
  const { data, error } = await supabase
    .from('diplomatic_proposals')
    .select('*')
    .eq('to_agency_id', agencyId)
    .eq('status', 'pending');
  if (error) throw new Error(error.message);
  return (data || []).filter((proposal) => livePendingProposal(proposal, now)).length;
}

async function findActiveAgreementForPair(supabase, firstAgencyId, secondAgencyId, agreementType, now) {
  const agreements = await loadAgreementsForAgency(supabase, firstAgencyId);
  return agreements.find((agreement) => (
    counterpartIdFor(agreement, firstAgencyId) === secondAgencyId
    && agreement.agreement_type === agreementType
    && activeAgreement(agreement, now)
  )) || null;
}

async function findPendingPairProposal(supabase, fromAgencyId, toAgencyId, proposalType, now) {
  const [forward, reverse] = await Promise.all([
    supabase
      .from('diplomatic_proposals')
      .select('*')
      .eq('from_agency_id', fromAgencyId)
      .eq('to_agency_id', toAgencyId)
      .eq('proposal_type', proposalType)
      .eq('status', 'pending'),
    supabase
      .from('diplomatic_proposals')
      .select('*')
      .eq('from_agency_id', toAgencyId)
      .eq('to_agency_id', fromAgencyId)
      .eq('proposal_type', proposalType)
      .eq('status', 'pending'),
  ]);
  if (forward.error) throw new Error(forward.error.message);
  if (reverse.error) throw new Error(reverse.error.message);
  return [...(forward.data || []), ...(reverse.data || [])]
    .find((proposal) => livePendingProposal(proposal, now)) || null;
}

async function evaluateProposal(supabase, options) {
  const config = options.config || DIPLOMACY_CONFIG;
  const now = nowDate(options.now);
  const season = options.season || {};
  const { fromAgency, toAgency, durationDays, agreementType } = options;
  const type = config.agreementTypes[agreementType];
  if (!type) {
    throw new DiplomacyError('UNSUPPORTED_AGREEMENT', 'Unsupported agreement type.');
  }

  const allowedDuration = Number.isInteger(durationDays)
    && type.allowedDurationsGameDays.includes(durationDays);
  if (!allowedDuration) {
    throw new DiplomacyError('INVALID_DURATION', 'Unsupported agreement duration.');
  }

  const relation = await loadRelation(supabase, fromAgency.id, toAgency.id);
  const relationScore = Number(relation?.relation_score ?? config.relation.initialScore);
  const crossBloc = isCrossBloc(fromAgency.bloc, toAgency.bloc);
  const same = sameBloc(fromAgency.bloc, toAgency.bloc);
  let acceptanceScore = relationScore;
  if (same) acceptanceScore += config.relation.sameBlocAcceptanceBonus;
  if (crossBloc) acceptanceScore -= config.crossBloc.acceptancePenalty;

  const costFunding = Math.round(
    Number(type.baseCostFunding) * (crossBloc ? Number(config.crossBloc.costMultiplier) : 1),
  );
  const cooldownGameDays = crossBloc
    ? config.crossBloc.cooldownGameDays
    : config.cooldownGameDays;
  const cooldownUntil = new Date(now.getTime() + gameDaysToMs(cooldownGameDays, season));
  const expiresAt = new Date(now.getTime() + gameDaysToMs(config.proposalExpiryGameDays, season));
  const currentCooldownUntil = toDate(relation?.cooldown_until);
  const saturation = await saturationChecksForPair(supabase, fromAgency, toAgency, {
    config,
    now,
    season,
  });

  return {
    agreementType,
    durationDays,
    relationScore,
    acceptance: acceptanceBand(acceptanceScore, config),
    crossBlocPenalty: crossBloc,
    costFunding,
    cooldownGameDays,
    cooldownUntil: cooldownUntil.toISOString(),
    currentCooldownUntil: currentCooldownUntil ? currentCooldownUntil.toISOString() : null,
    expiresAt: expiresAt.toISOString(),
    saturation,
    saturationError: saturationErrorFromChecks(saturation),
  };
}

function proposalReasonFromError(error) {
  if (error instanceof DiplomacyError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }
  throw error;
}

async function prepareProposal(supabase, options) {
  const config = options.config || DIPLOMACY_CONFIG;
  const now = nowDate(options.now);
  const season = await loadSeason(supabase, options.season);
  const fromAgencyId = options.fromAgencyId;
  const targetAgencyId = options.targetAgencyId;
  const agreementType = options.agreementType || 'cooperation';
  const type = config.agreementTypes[agreementType];
  if (!type) {
    throw new DiplomacyError('UNSUPPORTED_AGREEMENT', 'Unsupported agreement type.');
  }

  if (!fromAgencyId || !targetAgencyId) {
    throw new DiplomacyError('AGENCY_NOT_FOUND', 'Both agencies are required.');
  }
  if (String(fromAgencyId) === String(targetAgencyId)) {
    throw new DiplomacyError('SELF_PROPOSAL', 'An agency cannot negotiate with itself.');
  }

  const [fromAgency, toAgency] = await Promise.all([
    loadAgency(supabase, fromAgencyId),
    loadAgency(supabase, targetAgencyId),
  ]);
  if (!fromAgency) throw new DiplomacyError('AGENCY_NOT_FOUND', 'Agency not found.');
  if (!toAgency) throw new DiplomacyError('TARGET_NOT_FOUND', 'Target agency not found.');
  if (!fromAgency.is_active) throw new DiplomacyError('AGENCY_INACTIVE', 'Agency is inactive.');
  if (!toAgency.is_active) throw new DiplomacyError('TARGET_INACTIVE', 'Target agency is inactive.');
  if (fromAgency.season_id !== toAgency.season_id) {
    throw new DiplomacyError('SEASON_MISMATCH', 'Agencies belong to different seasons.');
  }

  const durationDays = Number(options.durationDays);
  if (!Number.isInteger(durationDays) || !type.allowedDurationsGameDays.includes(durationDays)) {
    throw new DiplomacyError('INVALID_DURATION', 'Unsupported agreement duration.');
  }

  const note = normalizedNote(options.note, config);
  const evaluation = await evaluateProposal(supabase, {
    fromAgency,
    toAgency,
    durationDays,
    agreementType,
    config,
    now,
    season,
  });
  const relation = await loadRelation(supabase, fromAgency.id, toAgency.id);
  const reasons = [];

  if (evaluation.currentCooldownUntil && new Date(evaluation.currentCooldownUntil) > now) {
    reasons.push(new DiplomacyError('COOLDOWN', 'This pair is still cooling down.', {
      cooldownUntil: evaluation.currentCooldownUntil,
    }));
  }

  const duplicate = await findPendingPairProposal(
    supabase,
    fromAgency.id,
    toAgency.id,
    agreementType,
    now,
  );
  if (duplicate) {
    reasons.push(new DiplomacyError('DUPLICATE_PROPOSAL', 'A proposal for this pair is already pending.', {
      proposalId: duplicate.id,
    }));
  }

  const existingAgreement = await findActiveAgreementForPair(
    supabase,
    fromAgency.id,
    toAgency.id,
    agreementType,
    now,
  );
  if (existingAgreement) {
    reasons.push(new DiplomacyError('DUPLICATE_AGREEMENT', 'An agreement for this pair is already active.', {
      agreementId: existingAgreement.id,
      endsAt: existingAgreement.ends_at,
    }));
  }

  const outgoing = await countPendingOutgoing(supabase, fromAgency.id, now);
  if (outgoing >= config.limits.maxPendingOutgoingPerAgency) {
    reasons.push(new DiplomacyError('MAX_PROPOSALS', 'Outgoing proposal limit reached.', {
      pending: outgoing,
      limit: config.limits.maxPendingOutgoingPerAgency,
    }));
  }

  const incoming = await countPendingIncoming(supabase, toAgency.id, now);
  if (incoming >= config.limits.maxPendingIncomingPerAgency) {
    reasons.push(new DiplomacyError('TARGET_MAX_PROPOSALS', 'Target inbox is full.', {
      pending: incoming,
      limit: config.limits.maxPendingIncomingPerAgency,
    }));
  }

  if (Number(fromAgency.funding_usd) < evaluation.costFunding) {
    reasons.push(new DiplomacyError('INSUFFICIENT_FUNDING', 'Insufficient funding.', {
      required: evaluation.costFunding,
      available: Number(fromAgency.funding_usd) || 0,
    }));
  }

  if (evaluation.saturationError) {
    reasons.push(evaluation.saturationError);
  }

  return {
    allowed: reasons.length === 0,
    reason: reasons[0] ? proposalReasonFromError(reasons[0]) : null,
    reasons: reasons.map(proposalReasonFromError),
    fromAgency,
    toAgency,
    relation,
    evaluation,
    durationDays,
    note,
    agreementType,
    season,
    now,
    outgoingPending: outgoing,
    incomingPending: incoming,
  };
}

function publicPreview(prepared, config = DIPLOMACY_CONFIG) {
  const evaluation = prepared.evaluation;
  return {
    allowed: prepared.allowed,
    reason: prepared.reason,
    reasons: prepared.reasons,
    target: publicAgency(prepared.toAgency),
    costFunding: evaluation.costFunding,
    cooldownUntil: evaluation.cooldownUntil,
    currentCooldownUntil: evaluation.currentCooldownUntil,
    expiresAt: evaluation.expiresAt,
    acceptance: evaluation.acceptance,
    crossBlocPenalty: evaluation.crossBlocPenalty,
    saturation: evaluation.saturation,
    limits: {
      outgoingPending: prepared.outgoingPending,
      outgoingLimit: config.limits.maxPendingOutgoingPerAgency,
      incomingPending: prepared.incomingPending,
      incomingLimit: config.limits.maxPendingIncomingPerAgency,
    },
  };
}

async function previewProposal(supabase, options = {}) {
  const config = options.config || DIPLOMACY_CONFIG;
  const prepared = await prepareProposal(supabase, { ...options, config });
  return publicPreview(prepared, config);
}

async function chargeFunding(supabase, agency, amount) {
  const cost = Number(amount) || 0;
  const available = Number(agency.funding_usd) || 0;
  if (available < cost) {
    throw new DiplomacyError('INSUFFICIENT_FUNDING', 'Insufficient funding.', {
      required: cost,
      available,
    });
  }
  const { data, error } = await supabase
    .from('agencies')
    .update({ funding_usd: available - cost })
    .eq('id', agency.id)
    .eq('is_active', true)
    .select('id, funding_usd')
    .single();
  if (error || !data) {
    throw new DiplomacyError('INSUFFICIENT_FUNDING', 'Funding could not be reserved.', {
      required: cost,
      available,
    });
  }
  return Number(data.funding_usd);
}

async function refundFunding(supabase, agencyId, amount) {
  const agency = await loadAgency(supabase, agencyId);
  if (!agency) return null;
  const { error } = await supabase
    .from('agencies')
    .update({ funding_usd: Number(agency.funding_usd || 0) + Number(amount || 0) })
    .eq('id', agencyId);
  if (error) throw new Error(error.message);
  return null;
}

async function touchRelation(supabase, options) {
  const config = options.config || DIPLOMACY_CONFIG;
  const now = nowDate(options.now);
  const existing = await loadRelation(supabase, options.firstAgencyId, options.secondAgencyId);
  const currentScore = Number(existing?.relation_score ?? config.relation.initialScore);
  const score = clamp(
    currentScore + (Number(options.scoreDelta) || 0),
    config.relation.minScore,
    config.relation.maxScore,
  );
  const { lowId, highId } = normalizePair(options.firstAgencyId, options.secondAgencyId);
  const { data, error } = await supabase.from('agency_relations').upsert([{
    agency_low_id: lowId,
    agency_high_id: highId,
    relation_score: score,
    status: relationStatusForScore(score, config),
    cooldown_until: options.cooldownUntil || existing?.cooldown_until || null,
    last_action_at: now.toISOString(),
  }], { onConflict: 'agency_low_id,agency_high_id' }).select().single();
  if (error) throw new Error(`relation update: ${error.message}`);
  return data;
}

async function createProposal(supabase, options = {}) {
  const config = options.config || DIPLOMACY_CONFIG;
  const prepared = await prepareProposal(supabase, { ...options, config });
  if (!prepared.allowed) {
    const reason = prepared.reason;
    throw new DiplomacyError(reason.code, reason.message, reason.details);
  }

  const { fromAgency, toAgency, evaluation, durationDays, note, agreementType, season, now } = prepared;
  const newFunding = await chargeFunding(supabase, fromAgency, evaluation.costFunding);

  const { data: proposal, error: insertError } = await supabase
    .from('diplomatic_proposals')
    .insert([{
      season_id: season.id,
      from_agency_id: fromAgency.id,
      to_agency_id: toAgency.id,
      proposal_type: agreementType,
      terms: { duration_days: durationDays },
      note: note || null,
      status: 'pending',
      expires_at: evaluation.expiresAt,
    }])
    .select()
    .single();

  if (insertError || !proposal) {
    await refundFunding(supabase, fromAgency.id, evaluation.costFunding);
    if (/duplicate|unique/i.test(String(insertError?.message || ''))) {
      throw new DiplomacyError('DUPLICATE_PROPOSAL', 'A proposal for this pair is already pending.');
    }
    throw new Error(`proposal insert: ${insertError?.message || 'unknown error'}`);
  }

  await touchRelation(supabase, {
    firstAgencyId: fromAgency.id,
    secondAgencyId: toAgency.id,
    cooldownUntil: evaluation.cooldownUntil,
    now,
    config,
  });

  await logDiplomaticEvent(supabase, {
    season_id: season.id,
    actor_agency_id: fromAgency.id,
    counterpart_agency_id: toAgency.id,
    event_type: 'DIPLOMACY_PROPOSAL_SENT',
    proposal_id: proposal.id,
    description: `${fromAgency.name} sent a cooperation proposal to ${toAgency.name}.`,
    data: {
      acceptance: evaluation.acceptance,
      cross_bloc_penalty: evaluation.crossBlocPenalty,
      duration_days: durationDays,
      cost_funding: evaluation.costFunding,
    },
  });

  let expiryScheduled = true;
  try {
    await scheduleEvent(supabase, {
      season_id: season.id,
      agency_id: toAgency.id,
      event_type: 'DIPLOMACY_PROPOSAL_EXPIRED',
      reference_id: proposal.id,
      payload: { proposal_id: proposal.id, expires_at: evaluation.expiresAt },
      execute_at: evaluation.expiresAt,
    });
  } catch {
    expiryScheduled = false;
  }

  return {
    proposal,
    evaluation: {
      acceptance: evaluation.acceptance,
      crossBlocPenalty: evaluation.crossBlocPenalty,
      costFunding: evaluation.costFunding,
      cooldownUntil: evaluation.cooldownUntil,
      expiresAt: evaluation.expiresAt,
    },
    target: publicAgency(toAgency),
    newFundingUsd: newFunding,
    expiryScheduled,
  };
}

async function expireProposalById(supabase, proposalId, options = {}) {
  const now = nowDate(options.now);
  const proposal = await maybeSingle(
    supabase.from('diplomatic_proposals').select('*').eq('id', proposalId),
  );
  if (!proposal) throw new DiplomacyError('PROPOSAL_NOT_FOUND', 'Proposal not found.');
  if (proposal.status !== 'pending') return { status: 'skipped', proposal };
  const expiresAt = toDate(proposal.expires_at);
  if (!expiresAt || expiresAt.getTime() > now.getTime()) {
    return { status: 'still_pending', proposal };
  }

  const { data: updated, error } = await supabase
    .from('diplomatic_proposals')
    .update({ status: 'expired', responded_at: now.toISOString() })
    .eq('id', proposal.id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) return { status: 'skipped', proposal };

  await logDiplomaticEvent(supabase, {
    season_id: proposal.season_id,
    actor_agency_id: proposal.to_agency_id,
    counterpart_agency_id: proposal.from_agency_id,
    event_type: 'DIPLOMACY_PROPOSAL_EXPIRED',
    proposal_id: proposal.id,
    description: 'Proposal expired.',
    data: { reason: 'expired' },
  });

  return { status: 'expired', proposal: updated };
}

async function expireAgreementById(supabase, agreementId, options = {}) {
  const now = nowDate(options.now);
  const agreement = await maybeSingle(
    supabase.from('agency_agreements').select('*').eq('id', agreementId),
  );
  if (!agreement) throw new DiplomacyError('AGREEMENT_NOT_FOUND', 'Agreement not found.');
  if (agreement.status !== 'active') return { status: 'skipped', agreement };
  const endsAt = toDate(agreement.ends_at);
  if (!endsAt || endsAt.getTime() > now.getTime()) {
    return { status: 'still_active', agreement };
  }

  const { data: updated, error } = await supabase
    .from('agency_agreements')
    .update({ status: 'expired' })
    .eq('id', agreement.id)
    .eq('status', 'active')
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) return { status: 'skipped', agreement };

  await logDiplomaticEvent(supabase, {
    season_id: agreement.season_id,
    actor_agency_id: null,
    counterpart_agency_id: null,
    event_type: 'DIPLOMACY_AGREEMENT_EXPIRED',
    agreement_id: agreement.id,
    description: 'Cooperation agreement expired.',
    data: {
      party_low_id: agreement.party_low_id,
      party_high_id: agreement.party_high_id,
    },
  });

  return { status: 'expired', agreement: updated };
}

async function expireProposals(supabase, options = {}) {
  const now = nowDate(options.now);
  const { data, error } = await supabase
    .from('diplomatic_proposals')
    .select('*')
    .eq('status', 'pending');
  if (error) throw new Error(error.message);
  const due = (data || []).filter((proposal) => {
    const expiresAt = toDate(proposal.expires_at);
    return expiresAt && expiresAt.getTime() <= now.getTime();
  });
  let expired = 0;
  for (const proposal of due) {
    const result = await expireProposalById(supabase, proposal.id, { ...options, now });
    if (result.status === 'expired') expired += 1;
  }
  return { expired };
}

async function expireAgreements(supabase, options = {}) {
  const now = nowDate(options.now);
  const { data, error } = await supabase
    .from('agency_agreements')
    .select('*')
    .eq('status', 'active');
  if (error) throw new Error(error.message);
  const due = (data || []).filter((agreement) => {
    const endsAt = toDate(agreement.ends_at);
    return endsAt && endsAt.getTime() <= now.getTime();
  });

  const affected = new Set();
  let expired = 0;
  for (const agreement of due) {
    const result = await expireAgreementById(supabase, agreement.id, { ...options, now });
    if (result.status === 'expired') {
      expired += 1;
      affected.add(agreement.party_low_id);
      affected.add(agreement.party_high_id);
    }
  }
  for (const agencyId of affected) {
    await refreshSaturationForAgency(supabase, agencyId, {
      config: options.config || DIPLOMACY_CONFIG,
      now,
      season: options.season,
    });
  }
  return { expired, affectedAgencies: [...affected] };
}

function mapRpcError(error) {
  const message = String(error?.message || '');
  const known = Object.keys(ERROR_STATUS).find((code) => message.includes(code));
  if (known) {
    return new DiplomacyError(known, message);
  }
  return new Error(`diplomacy rpc: ${message || 'unknown error'}`);
}

async function createAgreement(supabase, options = {}) {
  const config = options.config || DIPLOMACY_CONFIG;
  const season = await loadSeason(supabase, options.season);
  const type = config.agreementTypes.cooperation;
  const cooldownSeconds = Math.max(
    0,
    Math.round(gameDaysToMs(config.cooldownGameDays, season) / 1000),
  );
  const crossBlocCooldownSeconds = Math.max(
    0,
    Math.round(gameDaysToMs(config.crossBloc.cooldownGameDays, season) / 1000),
  );

  const { data, error } = await supabase.rpc('accept_diplomatic_proposal', {
    p_proposal_id: options.proposalId,
    p_actor_agency_id: options.actorAgencyId,
    p_saturation_ratio: config.saturationRatio,
    p_allowed_durations: [...type.allowedDurationsGameDays],
    p_initial_score: config.relation.initialScore,
    p_relation_gain: type.relationGainOnAccept,
    p_cooldown_seconds: cooldownSeconds,
    p_cross_bloc_cooldown_seconds: crossBlocCooldownSeconds,
    p_min_score: config.relation.minScore,
    p_max_score: config.relation.maxScore,
    p_cooperative_threshold: config.relation.cooperativeThreshold,
    p_allied_threshold: config.relation.alliedThreshold,
  });

  if (error) throw mapRpcError(error);
  if (data?.error) {
    throw new DiplomacyError(data.error, String(data.error).replace(/_/g, ' ').toLowerCase());
  }
  return data;
}

async function proposalCounterDepth(supabase, proposal) {
  let depth = 0;
  let parentId = proposal.parent_proposal_id || null;
  while (parentId && depth < 10) {
    depth += 1;
    const parent = await maybeSingle(
      supabase.from('diplomatic_proposals').select('id, parent_proposal_id').eq('id', parentId),
    );
    parentId = parent?.parent_proposal_id || null;
  }
  return depth;
}

async function respondToProposal(supabase, options = {}) {
  const config = options.config || DIPLOMACY_CONFIG;
  const now = nowDate(options.now);
  const season = await loadSeason(supabase, options.season);
  const action = String(options.action || '').toLowerCase();
  if (!['accept', 'reject', 'counter'].includes(action)) {
    throw new DiplomacyError('INVALID_ACTION', 'Unsupported response action.');
  }

  const proposal = await maybeSingle(
    supabase.from('diplomatic_proposals').select('*').eq('id', options.proposalId),
  );
  if (!proposal) throw new DiplomacyError('PROPOSAL_NOT_FOUND', 'Proposal not found.');
  if (proposal.to_agency_id !== options.actorAgencyId) {
    throw new DiplomacyError('FORBIDDEN_PROPOSAL', 'Only the recipient can respond.');
  }
  if (proposal.status !== 'pending') {
    throw new DiplomacyError('PROPOSAL_NOT_PENDING', 'Proposal is no longer pending.');
  }
  const expiresAt = toDate(proposal.expires_at);
  if (!expiresAt || expiresAt.getTime() <= now.getTime()) {
    await expireProposalById(supabase, proposal.id, { now });
    throw new DiplomacyError('PROPOSAL_EXPIRED', 'Proposal has expired.');
  }

  const actor = await loadAgency(supabase, options.actorAgencyId);
  if (!actor) throw new DiplomacyError('AGENCY_NOT_FOUND', 'Agency not found.');
  if (!actor.is_active) throw new DiplomacyError('AGENCY_INACTIVE', 'Agency is inactive.');

  if (action === 'accept') {
    const result = await createAgreement(supabase, {
      proposalId: proposal.id,
      actorAgencyId: options.actorAgencyId,
      config,
      season,
      now,
    });
    return { status: 'accepted', ...result };
  }

  if (action === 'reject') {
    const reason = normalizedNote(options.reason, config);
    const { data: updated, error } = await supabase
      .from('diplomatic_proposals')
      .update({ status: 'rejected', responded_at: now.toISOString() })
      .eq('id', proposal.id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new DiplomacyError('PROPOSAL_NOT_PENDING', 'Proposal is no longer pending.');

    const cooldownUntil = new Date(
      now.getTime() + gameDaysToMs(config.cooldownGameDays, season),
    ).toISOString();
    await touchRelation(supabase, {
      firstAgencyId: proposal.from_agency_id,
      secondAgencyId: proposal.to_agency_id,
      scoreDelta: -Number(config.relation.rejectionPenalty),
      cooldownUntil,
      now,
      config,
    });

    await logDiplomaticEvent(supabase, {
      season_id: proposal.season_id,
      actor_agency_id: proposal.to_agency_id,
      counterpart_agency_id: proposal.from_agency_id,
      event_type: 'DIPLOMACY_PROPOSAL_REJECTED',
      proposal_id: proposal.id,
      description: 'Proposal rejected.',
      data: { reason: reason || 'no_reason_given' },
    });

    return { status: 'rejected', proposal: updated };
  }

  const depth = await proposalCounterDepth(supabase, proposal);
  if (depth >= config.limits.maxCounterDepth) {
    throw new DiplomacyError('COUNTER_LIMIT', 'This proposal has reached the counter limit.');
  }

  const originalSender = await loadAgency(supabase, proposal.from_agency_id);
  if (!originalSender) throw new DiplomacyError('AGENCY_NOT_FOUND', 'Agency not found.');
  if (!originalSender.is_active) throw new DiplomacyError('TARGET_INACTIVE', 'Target agency is inactive.');
  if (originalSender.id === actor.id) {
    throw new DiplomacyError('SELF_PROPOSAL', 'An agency cannot negotiate with itself.');
  }

  const durationDays = Number(proposal.terms?.duration_days);
  const type = config.agreementTypes[proposal.proposal_type];
  if (!type || !Number.isInteger(durationDays) || !type.allowedDurationsGameDays.includes(durationDays)) {
    throw new DiplomacyError('INVALID_DURATION', 'Proposal terms are invalid.');
  }

  const evaluation = await evaluateProposal(supabase, {
    fromAgency: actor,
    toAgency: originalSender,
    durationDays,
    agreementType: proposal.proposal_type,
    config,
    now,
    season,
  });
  if (evaluation.saturationError) {
    const error = evaluation.saturationError;
    throw new DiplomacyError(error.code, error.message, error.details);
  }

  const counterCost = Math.round(Number(type.counterCostFunding) * (
    evaluation.crossBlocPenalty ? Number(config.crossBloc.costMultiplier) : 1
  ));
  if (Number(actor.funding_usd) < counterCost) {
    throw new DiplomacyError('INSUFFICIENT_FUNDING', 'Insufficient funding for a counter.', {
      required: counterCost,
      available: Number(actor.funding_usd) || 0,
    });
  }

  const outgoing = await countPendingOutgoing(supabase, actor.id, now);
  if (outgoing >= config.limits.maxPendingOutgoingPerAgency) {
    throw new DiplomacyError('MAX_PROPOSALS', 'Outgoing proposal limit reached.', {
      pending: outgoing,
      limit: config.limits.maxPendingOutgoingPerAgency,
    });
  }
  const incoming = await countPendingIncoming(supabase, originalSender.id, now);
  if (incoming >= config.limits.maxPendingIncomingPerAgency) {
    throw new DiplomacyError('TARGET_MAX_PROPOSALS', 'Target inbox is full.', {
      pending: incoming,
      limit: config.limits.maxPendingIncomingPerAgency,
    });
  }

  const note = normalizedNote(options.note, config);
  const { data: parentUpdated, error: parentError } = await supabase
    .from('diplomatic_proposals')
    .update({ status: 'countered', responded_at: now.toISOString() })
    .eq('id', proposal.id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (parentError) throw new Error(parentError.message);
  if (!parentUpdated) throw new DiplomacyError('PROPOSAL_NOT_PENDING', 'Proposal is no longer pending.');

  let newFunding = Number(actor.funding_usd);
  try {
    newFunding = await chargeFunding(supabase, actor, counterCost);
    const { data: counterProposal, error: counterError } = await supabase
      .from('diplomatic_proposals')
      .insert([{
        season_id: proposal.season_id,
        from_agency_id: actor.id,
        to_agency_id: originalSender.id,
        proposal_type: proposal.proposal_type,
        terms: { duration_days: durationDays },
        note: note || null,
        status: 'pending',
        parent_proposal_id: proposal.id,
        expires_at: evaluation.expiresAt,
      }])
      .select()
      .single();
    if (counterError || !counterProposal) {
      throw new Error(`counter insert: ${counterError?.message || 'unknown error'}`);
    }

    await touchRelation(supabase, {
      firstAgencyId: actor.id,
      secondAgencyId: originalSender.id,
      cooldownUntil: evaluation.cooldownUntil,
      now,
      config,
    });

    await logDiplomaticEvent(supabase, {
      season_id: proposal.season_id,
      actor_agency_id: actor.id,
      counterpart_agency_id: originalSender.id,
      event_type: 'DIPLOMACY_PROPOSAL_COUNTERED',
      proposal_id: proposal.id,
      description: 'Proposal countered with a reverse proposal.',
      data: {
        counter_proposal_id: counterProposal.id,
        duration_days: durationDays,
        cost_funding: counterCost,
        cross_bloc_penalty: evaluation.crossBlocPenalty,
      },
    });

    try {
      await scheduleEvent(supabase, {
        season_id: proposal.season_id,
        agency_id: originalSender.id,
        event_type: 'DIPLOMACY_PROPOSAL_EXPIRED',
        reference_id: counterProposal.id,
        payload: { proposal_id: counterProposal.id, expires_at: evaluation.expiresAt },
        execute_at: evaluation.expiresAt,
      });
    } catch {
      // Housekeeping expiry still covers this proposal.
    }

    return {
      status: 'countered',
      proposal: counterProposal,
      parentProposal: parentUpdated,
      costFunding: counterCost,
      newFundingUsd: newFunding,
      expiresAt: evaluation.expiresAt,
    };
  } catch (error) {
    try {
      await refundFunding(supabase, actor.id, counterCost);
    } catch {
      // Best-effort rollback; the error is reported below.
    }
    try {
      await supabase
        .from('diplomatic_proposals')
        .update({ status: 'pending', responded_at: null })
        .eq('id', proposal.id)
        .eq('status', 'countered');
    } catch {
      // Best-effort rollback; the error is reported below.
    }
    throw error;
  }
}

async function withdrawProposal(supabase, options = {}) {
  const now = nowDate(options.now);
  const proposal = await maybeSingle(
    supabase.from('diplomatic_proposals').select('*').eq('id', options.proposalId),
  );
  if (!proposal) throw new DiplomacyError('PROPOSAL_NOT_FOUND', 'Proposal not found.');
  if (proposal.from_agency_id !== options.actorAgencyId) {
    throw new DiplomacyError('FORBIDDEN_PROPOSAL', 'Only the sender can withdraw.');
  }
  if (proposal.status !== 'pending') {
    throw new DiplomacyError('PROPOSAL_NOT_PENDING', 'Proposal is no longer pending.');
  }

  const { data: updated, error } = await supabase
    .from('diplomatic_proposals')
    .update({ status: 'withdrawn', responded_at: now.toISOString() })
    .eq('id', proposal.id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) throw new DiplomacyError('PROPOSAL_NOT_PENDING', 'Proposal is no longer pending.');

  await logDiplomaticEvent(supabase, {
    season_id: proposal.season_id,
    actor_agency_id: proposal.from_agency_id,
    counterpart_agency_id: proposal.to_agency_id,
    event_type: 'DIPLOMACY_PROPOSAL_WITHDRAWN',
    proposal_id: proposal.id,
    description: 'Proposal withdrawn by the sender.',
    data: {},
  });

  return { status: 'withdrawn', proposal: updated };
}

async function terminateAgreement(supabase, options = {}) {
  const config = options.config || DIPLOMACY_CONFIG;
  const now = nowDate(options.now);
  const season = await loadSeason(supabase, options.season);
  const agreement = await maybeSingle(
    supabase.from('agency_agreements').select('*').eq('id', options.agreementId),
  );
  if (!agreement) throw new DiplomacyError('AGREEMENT_NOT_FOUND', 'Agreement not found.');
  if (
    agreement.party_low_id !== options.actorAgencyId
    && agreement.party_high_id !== options.actorAgencyId
  ) {
    throw new DiplomacyError('FORBIDDEN_AGREEMENT', 'Agency is not a party to this agreement.');
  }
  if (!activeAgreement(agreement, now)) {
    throw new DiplomacyError('AGREEMENT_NOT_ACTIVE', 'Agreement is no longer active.');
  }

  const { data: updated, error } = await supabase
    .from('agency_agreements')
    .update({ status: 'terminated', terminated_at: now.toISOString() })
    .eq('id', agreement.id)
    .eq('status', 'active')
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) throw new DiplomacyError('AGREEMENT_NOT_ACTIVE', 'Agreement is no longer active.');

  const otherAgencyId = counterpartIdFor(agreement, options.actorAgencyId);
  await touchRelation(supabase, {
    firstAgencyId: options.actorAgencyId,
    secondAgencyId: otherAgencyId,
    scoreDelta: -Number(config.relation.terminationPenalty),
    cooldownUntil: new Date(
      now.getTime() + gameDaysToMs(config.cooldownGameDays, season),
    ).toISOString(),
    now,
    config,
  });

  await logDiplomaticEvent(supabase, {
    season_id: agreement.season_id,
    actor_agency_id: options.actorAgencyId,
    counterpart_agency_id: otherAgencyId,
    event_type: 'DIPLOMACY_AGREEMENT_TERMINATED',
    agreement_id: agreement.id,
    description: 'Cooperation agreement terminated.',
    data: { agreement_type: agreement.agreement_type },
  });

  await Promise.all([
    refreshSaturationForAgency(supabase, options.actorAgencyId, { config, now, season }),
    refreshSaturationForAgency(supabase, otherAgencyId, { config, now, season }),
  ]);

  return { agreement: updated };
}

function npcProfileFor(agency, config) {
  const key = agency?.npc_profile?.profile;
  return config.npc.profiles[key] || config.npc.profiles[config.npc.defaultProfile];
}

function npcActionSeed(agencyId, gameDay, eventId, suffix = '') {
  const base = `npc:${agencyId}:${gameDay}:${eventId}`;
  return suffix ? `${base}:${suffix}` : base;
}

function gameClockPosition(season, now, config) {
  const start = toDate(season.start_real_time);
  const multiplier = seasonMultiplier(season);
  const gameDays = start
    ? realMsToGameDays(now.getTime() - start.getTime(), multiplier)
    : 0;
  const safeDays = Math.max(0, gameDays);
  return {
    gameDays: safeDays,
    gameDay: Math.floor(safeDays),
    gameSlot: Math.floor(safeDays * config.npc.staggerBuckets),
  };
}

function npcAcceptanceChance({ profile, relationScore, crossBloc, same, config }) {
  let chance = Number(profile.acceptChance) || 0;
  chance += (Number(relationScore) - Number(config.relation.initialScore)) / 200;
  chance += same ? Number(profile.sameBlocBonus) || 0 : 0;
  chance -= crossBloc ? Number(profile.crossBlocAcceptPenalty) || 0 : 0;
  return clamp(chance, 0.03, 0.95);
}

function npcTargetScore({ npc, target, relationScore, profile }) {
  let score = Number(relationScore) || 0;
  if (sameBloc(npc.bloc, target.bloc)) {
    score += 20 + (Number(profile.sameBlocBonus) || 0) * 100;
  }
  if (isCrossBloc(npc.bloc, target.bloc)) {
    score -= (Number(profile.crossBlocInitiationPenalty) || 0) * 100;
  }
  if (target.controller_type === 'player') score += 5;
  return score;
}

async function tickNpcDiplomacy(supabase, event, options = {}) {
  const config = options.config || DIPLOMACY_CONFIG;
  const now = nowDate(options.now);
  const season = await loadSeason(supabase, options.season);
  const eventId = String(event?.id || 'manual');
  const clock = gameClockPosition(season, now, config);

  const existingMarker = await maybeSingle(
    supabase
      .from('diplomatic_events')
      .select('id, data')
      .eq('event_type', 'DIPLOMACY_NPC_TICK')
      .contains('data', { game_slot: clock.gameSlot }),
  );
  if (existingMarker) {
    return {
      skipped: true,
      reason: 'game_slot_already_processed',
      gameDay: clock.gameDay,
      gameSlot: clock.gameSlot,
    };
  }

  const { data: npcRows, error: npcError } = await supabase
    .from('agencies')
    .select('*')
    .eq('season_id', season.id)
    .eq('controller_type', 'npc')
    .eq('is_active', true);
  if (npcError) throw new Error(npcError.message);

  const eligible = (npcRows || []).filter((npc) => (
    clock.gameSlot % config.npc.staggerBuckets
    === hashSeed(npc.id) % config.npc.staggerBuckets
  ));

  let proposalCount = 0;
  let responseCount = 0;
  const actions = [];

  let allAgencies = [];
  if (eligible.length > 0) {
    const { data: activeRows, error: activeError } = await supabase
      .from('agencies')
      .select('*')
      .eq('season_id', season.id)
      .eq('is_active', true);
    if (activeError) throw new Error(activeError.message);
    allAgencies = activeRows || [];
  }

  for (const npc of eligible) {
    const profile = npcProfileFor(npc, config);
    let npcActions = 0;
    const inbound = (await loadProposalsForAgency(supabase, npc.id))
      .filter((proposal) => (
        proposal.to_agency_id === npc.id
        && livePendingProposal(proposal, now)
      ))
      .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

    for (const proposal of inbound.slice(0, config.npc.maxResponsesPerTick)) {
      if (npcActions >= config.npc.maxActionsPerTick) break;
      const fromAgency = await loadAgency(supabase, proposal.from_agency_id);
      if (!fromAgency || !fromAgency.is_active) continue;
      const relation = await loadRelation(supabase, npc.id, fromAgency.id);
      const relationScore = Number(relation?.relation_score ?? config.relation.initialScore);
      const cross = isCrossBloc(npc.bloc, fromAgency.bloc);
      const same = sameBloc(npc.bloc, fromAgency.bloc);
      const chance = npcAcceptanceChance({ profile, relationScore, crossBloc: cross, same, config });
      const rng = createSeededRng(npcActionSeed(npc.id, clock.gameDay, eventId, `respond:${proposal.id}`));
      const roll = rng();
      let action = 'reject';
      if (roll < chance) action = 'accept';
      else if (roll < chance + (Number(profile.counterChance) || 0)) action = 'counter';

      try {
        await respondToProposal(supabase, {
          proposalId: proposal.id,
          actorAgencyId: npc.id,
          action,
          reason: action === 'reject' ? 'NPC_POLICY' : null,
          config,
          now,
          season,
        });
        npcActions += 1;
        if (action === 'accept') responseCount += 1;
        else if (action === 'counter') {
          responseCount += 1;
          proposalCount += 1;
        }
        actions.push({ npc: npc.id, action, proposal: proposal.id });
      } catch (error) {
        if (!(error instanceof DiplomacyError)) throw error;
      }
    }

    if (npcActions >= config.npc.maxActionsPerTick) continue;

    const initiativeRng = createSeededRng(npcActionSeed(npc.id, clock.gameDay, eventId, 'initiate'));
    const initiativeRoll = initiativeRng();
    if (initiativeRoll >= Number(profile.initiateChance)) continue;

    const relations = await loadRelationsForAgency(supabase, npc.id);
    const relationByCounterpart = new Map(relations.map((relation) => [
      counterpartIdFor(relation, npc.id),
      relation,
    ]));
    const saturatedBlocs = new Set();
    if (npc.bloc === 'neutral') {
      const checks = await refreshSaturationForAgency(supabase, npc.id, {
        config,
        now,
        season,
        persist: false,
      });
      for (const check of checks) {
        if (check.isSaturated) saturatedBlocs.add(check.bloc);
      }
    }

    const candidates = allAgencies
      .filter((target) => target.id !== npc.id && target.is_active)
      .filter((target) => {
        if (npc.bloc === 'neutral' && saturatedBlocs.has(target.bloc)) return false;
        const relation = relationByCounterpart.get(target.id);
        const cooldown = toDate(relation?.cooldown_until);
        return !cooldown || cooldown.getTime() <= now.getTime();
      })
      .map((target) => {
        const relation = relationByCounterpart.get(target.id);
        const relationScore = Number(relation?.relation_score ?? config.relation.initialScore);
        return {
          target,
          score: npcTargetScore({ npc, target, relationScore, profile }),
        };
      })
      .sort((a, b) => (
        b.score - a.score
        || hashSeed(`${eventId}:${a.target.id}`) - hashSeed(`${eventId}:${b.target.id}`)
      ))
      .slice(0, config.npc.maxTargetCandidates);

    for (const candidate of candidates.slice(0, config.npc.maxProposalAttempts)) {
      const durations = config.agreementTypes.cooperation.allowedDurationsGameDays;
      const durationDays = durations[Math.floor(initiativeRng() * durations.length)];
      try {
        await createProposal(supabase, {
          fromAgencyId: npc.id,
          targetAgencyId: candidate.target.id,
          agreementType: 'cooperation',
          durationDays,
          note: null,
          config,
          now,
          season,
        });
        proposalCount += 1;
        npcActions += 1;
        actions.push({
          npc: npc.id,
          action: 'propose',
          target: candidate.target.id,
        });
        break;
      } catch (error) {
        if (!(error instanceof DiplomacyError)) throw error;
      }
    }
  }

  await expireProposals(supabase, { config, now, season });
  await refreshAllNeutralSaturation(supabase, { config, now, season });

  const { error: markerError } = await supabase.from('diplomatic_events').insert([{
    season_id: season.id,
    actor_agency_id: null,
    counterpart_agency_id: null,
    event_type: 'DIPLOMACY_NPC_TICK',
    description: 'NPC diplomacy tick.',
    data: {
      event_id: eventId,
      game_day: clock.gameDay,
      game_slot: clock.gameSlot,
      started_at: now.toISOString(),
      completed_at: now.toISOString(),
      proposals: proposalCount,
      responses: responseCount,
    },
  }]);
  if (markerError) throw new Error(`npc tick marker: ${markerError.message}`);

  return {
    skipped: false,
    gameDay: clock.gameDay,
    gameSlot: clock.gameSlot,
    eligibleNpcs: eligible.length,
    actions,
    proposals: proposalCount,
    responses: responseCount,
  };
}

async function loadRelationsForAgency(supabase, agencyId) {
  const [lowResult, highResult] = await Promise.all([
    supabase.from('agency_relations').select('*').eq('agency_low_id', agencyId),
    supabase.from('agency_relations').select('*').eq('agency_high_id', agencyId),
  ]);
  if (lowResult.error) throw new Error(lowResult.error.message);
  if (highResult.error) throw new Error(highResult.error.message);
  const byId = new Map();
  for (const row of [...(lowResult.data || []), ...(highResult.data || [])]) {
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

function relationCounterpartId(relation, agencyId) {
  return relation.agency_low_id === agencyId
    ? relation.agency_high_id
    : relation.agency_low_id;
}

async function listDirectory(supabase, options = {}) {
  const season = await loadSeason(supabase, options.season);
  const { data, error } = await supabase
    .from('agencies')
    .select('*')
    .eq('season_id', season.id);
  if (error) throw new Error(error.message);

  const all = data || [];
  const active = all.filter((agency) => agency.is_active);
  const inactive = all.filter((agency) => !agency.is_active);
  const search = String(options.search || '').trim().toLowerCase();
  const status = options.status || 'active';
  const bloc = options.bloc || 'all';

  const agencies = all
    .filter((agency) => {
      if (status === 'active' && !agency.is_active) return false;
      if (status === 'inactive' && agency.is_active) return false;
      if (bloc !== 'all' && agency.bloc !== bloc) return false;
      if (search) {
        const haystack = [agency.name, agency.code, agency.country]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    })
    .map(publicAgency)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    agencies,
    counts: {
      total: all.length,
      active: active.length,
      inactive: inactive.length,
      npc: active.filter((agency) => agency.controller_type === 'npc').length,
      player: active.filter((agency) => agency.controller_type === 'player').length,
    },
  };
}

async function listRelations(supabase, options = {}) {
  const config = options.config || DIPLOMACY_CONFIG;
  const now = nowDate(options.now);
  const agencyId = options.agencyId;
  const relations = await loadRelationsForAgency(supabase, agencyId);
  const agreements = (await loadAgreementsForAgency(supabase, agencyId))
    .filter((agreement) => activeAgreement(agreement, now));
  const activeCounts = new Map();
  for (const agreement of agreements) {
    const otherId = counterpartIdFor(agreement, agencyId);
    activeCounts.set(otherId, (activeCounts.get(otherId) || 0) + 1);
  }

  const counterpartIds = relations.map((relation) => relationCounterpartId(relation, agencyId));
  const agencies = await loadAgenciesByIds(supabase, counterpartIds);
  const agencyById = new Map(agencies.map((agency) => [agency.id, agency]));

  return relations
    .map((relation) => {
      const otherId = relationCounterpartId(relation, agencyId);
      return {
        id: relation.id,
        counterpart: publicAgency(agencyById.get(otherId)),
        relation_score: relation.relation_score,
        status: relation.status,
        cooldown_until: relation.cooldown_until,
        last_action_at: relation.last_action_at,
        active_agreements: activeCounts.get(otherId) || 0,
      };
    })
    .filter((relation) => relation.counterpart)
    .sort((a, b) => a.counterpart.name.localeCompare(b.counterpart.name));
}

async function getRelationDetail(supabase, options = {}) {
  const config = options.config || DIPLOMACY_CONFIG;
  const now = nowDate(options.now);
  const agencyId = options.agencyId;
  const counterpartId = options.counterpartId;
  if (agencyId === counterpartId) {
    throw new DiplomacyError('SELF_PROPOSAL', 'An agency cannot negotiate with itself.');
  }
  const [counterpart, relation] = await Promise.all([
    loadAgency(supabase, counterpartId),
    loadRelation(supabase, agencyId, counterpartId),
  ]);
  if (!counterpart) throw new DiplomacyError('TARGET_NOT_FOUND', 'Target agency not found.');

  const agreements = (await loadAgreementsForAgency(supabase, agencyId))
    .filter((agreement) => counterpartIdFor(agreement, agencyId) === counterpartId)
    .map(publicAgreement(agencyId, counterpart));
  const events = (await loadEventsForAgency(supabase, agencyId))
    .filter((event) => (
      event.actor_agency_id === counterpartId
      || event.counterpart_agency_id === counterpartId
    ))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .map(publicEvent);
  const proposals = (await loadProposalsForAgency(supabase, agencyId))
    .filter((proposal) => counterpartIdForProposal(proposal, agencyId) === counterpartId)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .map((proposal) => ({
      id: proposal.id,
      status: proposal.status,
      direction: proposal.from_agency_id === agencyId ? 'outgoing' : 'incoming',
      proposal_type: proposal.proposal_type,
      terms: proposal.terms,
      note: proposal.note,
      expires_at: proposal.expires_at,
      created_at: proposal.created_at,
      responded_at: proposal.responded_at,
    }));

  return {
    counterpart: publicAgency(counterpart),
    relation: {
      relation_score: relation?.relation_score ?? config.relation.initialScore,
      status: relation?.status || 'neutral',
      cooldown_until: relation?.cooldown_until || null,
      last_action_at: relation?.last_action_at || null,
    },
    active_agreements: agreements.filter((agreement) => agreement.status === 'active').length,
    agreements,
    proposals,
    events,
    evaluated_at: now.toISOString(),
  };
}

function publicAgreement(agencyId, counterpart) {
  return (agreement) => ({
    id: agreement.id,
    counterpart,
    agreement_type: agreement.agreement_type,
    terms: agreement.terms,
    status: agreement.status,
    started_at: agreement.started_at,
    ends_at: agreement.ends_at,
    terminated_at: agreement.terminated_at || null,
    source_proposal_id: agreement.source_proposal_id || null,
  });
}

function publicProposal(agencyId, counterpart, config, now = new Date()) {
  return (proposal) => {
    const expired = !livePendingProposal(proposal, now);
    const incoming = proposal.to_agency_id === agencyId;
    const canCounter = incoming
      && proposal.status === 'pending'
      && !expired
      && (!proposal.parent_proposal_id || config.limits.maxCounterDepth > 1);
    return {
      id: proposal.id,
      direction: incoming ? 'incoming' : 'outgoing',
      counterpart,
      proposal_type: proposal.proposal_type,
      terms: proposal.terms,
      note: proposal.note,
      status: proposal.status,
      expires_at: proposal.expires_at,
      created_at: proposal.created_at,
      responded_at: proposal.responded_at,
      parent_proposal_id: proposal.parent_proposal_id || null,
      can_respond: incoming && proposal.status === 'pending' && !expired,
      can_withdraw: !incoming && proposal.status === 'pending' && !expired,
      can_counter: canCounter,
    };
  };
}

async function listProposals(supabase, options = {}) {
  const config = options.config || DIPLOMACY_CONFIG;
  const now = nowDate(options.now);
  const agencyId = options.agencyId;
  const box = options.box || 'all';
  const proposals = await loadProposalsForAgency(supabase, agencyId);
  const filtered = proposals.filter((proposal) => {
    if (box === 'incoming') return proposal.to_agency_id === agencyId;
    if (box === 'outgoing') return proposal.from_agency_id === agencyId;
    return true;
  });
  const counterpartIds = filtered.map((proposal) => counterpartIdForProposal(proposal, agencyId));
  const agencies = await loadAgenciesByIds(supabase, counterpartIds);
  const agencyById = new Map(agencies.map((agency) => [agency.id, agency]));

  const items = filtered
    .map((proposal) => {
      const counterpart = publicAgency(agencyById.get(
        counterpartIdForProposal(proposal, agencyId),
      ));
      return publicProposal(agencyId, counterpart, config, now)(proposal);
    })
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  return {
    incoming: items.filter((item) => item.direction === 'incoming'),
    outgoing: items.filter((item) => item.direction === 'outgoing'),
    all: items,
  };
}

async function listAgreements(supabase, options = {}) {
  const agencyId = options.agencyId;
  const agreements = await loadAgreementsForAgency(supabase, agencyId);
  const counterpartIds = agreements.map((agreement) => counterpartIdFor(agreement, agencyId));
  const agencies = await loadAgenciesByIds(supabase, counterpartIds);
  const agencyById = new Map(agencies.map((agency) => [agency.id, agency]));

  const items = agreements
    .map((agreement) => {
      const counterpart = publicAgency(agencyById.get(
        counterpartIdFor(agreement, agencyId),
      ));
      return publicAgreement(agencyId, counterpart)(agreement);
    })
    .sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (b.status === 'active' && a.status !== 'active') return 1;
      return new Date(b.started_at || 0) - new Date(a.started_at || 0);
    });

  return {
    agreements: items,
    counts: {
      active: items.filter((item) => item.status === 'active').length,
      expired: items.filter((item) => item.status === 'expired').length,
      terminated: items.filter((item) => item.status === 'terminated').length,
    },
  };
}

async function getDiplomacyOverview(supabase, options = {}) {
  const config = options.config || DIPLOMACY_CONFIG;
  const now = nowDate(options.now);
  const season = await loadSeason(supabase, options.season);
  const agency = options.agency || await loadAgency(supabase, options.agencyId);
  if (!agency) throw new DiplomacyError('AGENCY_NOT_FOUND', 'Agency not found.');
  const agencyId = agency.id;

  const [relations, proposals, agreements, events, saturation] = await Promise.all([
    listRelations(supabase, { agencyId, config, now }),
    listProposals(supabase, { agencyId, config, now, box: 'all' }),
    listAgreements(supabase, { agencyId }),
    loadEventsForAgency(supabase, agencyId),
    agency.bloc === 'neutral'
      ? refreshSaturationForAgency(supabase, agencyId, { config, now, season, agency })
      : Promise.resolve([]),
  ]);

  const { data: blocRows, error: blocError } = await supabase
    .from('agencies')
    .select('*')
    .eq('season_id', season.id)
    .eq('is_active', true);
  if (blocError) throw new Error(blocError.message);

  const blocStats = ['western', 'eastern', 'neutral'].map((bloc) => {
    const rows = (blocRows || []).filter((row) => row.bloc === bloc);
    return {
      bloc,
      activeAgencies: rows.length,
      npcAgencies: rows.filter((row) => row.controller_type === 'npc').length,
      playerAgencies: rows.filter((row) => row.controller_type === 'player').length,
    };
  });

  const relationCounts = {
    neutral: relations.filter((relation) => relation.status === 'neutral').length,
    cooperative: relations.filter((relation) => relation.status === 'cooperative').length,
    allied: relations.filter((relation) => relation.status === 'allied').length,
    sanctioned: relations.filter((relation) => relation.status === 'sanctioned').length,
  };

  return {
    agency: publicAgency(agency),
    gameDate: formatGameDate(gameDateAt(season, now)),
    season: { id: season.id, name: season.name },
    blocs: blocStats,
    saturation,
    relations,
    relationCounts,
    proposals: {
      incomingPending: proposals.incoming.filter((proposal) => proposal.can_respond).length,
      outgoingPending: proposals.outgoing.filter((proposal) => proposal.status === 'pending').length,
      incoming: proposals.incoming,
      outgoing: proposals.outgoing,
    },
    agreements: {
      active: agreements.counts.active,
      expired: agreements.counts.expired,
      terminated: agreements.counts.terminated,
    },
    recentEvents: events
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(0, 12)
      .map(publicEvent),
    policy: getPublicPolicy(config),
  };
}

async function ensureNpcTickScheduled(supabase, options = {}) {
  const config = options.config || DIPLOMACY_CONFIG;
  const now = nowDate(options.now);
  const season = await loadSeason(supabase, options.season);
  const existing = await maybeSingle(
    supabase
      .from('scheduled_events')
      .select('*')
      .eq('event_type', 'DIPLOMACY_NPC_TICK')
      .eq('status', 'PENDING')
      .limit(1),
  );
  if (existing) return existing;

  const executeAt = new Date(
    now.getTime() + gameDaysToMs(config.npc.tickIntervalGameDays, season),
  ).toISOString();
  const { data, error } = await supabase.from('scheduled_events').insert([{
    season_id: season.id,
    agency_id: null,
    event_type: 'DIPLOMACY_NPC_TICK',
    reference_id: 'npc-tick',
    payload: { interval_game_days: config.npc.tickIntervalGameDays },
    execute_at: executeAt,
    status: 'PENDING',
  }]).select().single();
  if (error) throw new Error(`npc tick schedule: ${error.message}`);
  return data;
}

async function handleProposalExpired(supabase, event, options = {}) {
  const proposalId = event?.reference_id || event?.payload?.proposal_id;
  if (!proposalId) throw new Error('DIPLOMACY_PROPOSAL_EXPIRED is missing proposal_id');
  const result = await expireProposalById(supabase, proposalId, options);
  return {
    status: result.status,
    proposal_id: proposalId,
  };
}

async function handleAgreementExpired(supabase, event, options = {}) {
  const agreementId = event?.reference_id || event?.payload?.agreement_id;
  if (!agreementId) throw new Error('DIPLOMACY_AGREEMENT_EXPIRED is missing agreement_id');
  const result = await expireAgreementById(supabase, agreementId, options);
  if (result.status === 'expired') {
    await Promise.all([
      refreshSaturationForAgency(supabase, result.agreement.party_low_id, options),
      refreshSaturationForAgency(supabase, result.agreement.party_high_id, options),
    ]);
  }
  return {
    status: result.status,
    agreement_id: agreementId,
  };
}

async function handleNpcTick(supabase, event, options = {}) {
  const config = options.config || DIPLOMACY_CONFIG;
  const season = await loadSeason(supabase, options.season);
  await ensureNpcTickScheduled(supabase, {
    config,
    now: options.now,
    season,
  });
  return tickNpcDiplomacy(supabase, event, { ...options, config, season });
}

module.exports = {
  DiplomacyError,
  DIPLOMACY_CONFIG,
  getPublicPolicy,
  sanitizeText,
  normalizePair,
  isCrossBloc,
  saturationThreshold,
  acceptanceBand,
  publicAgency,
  getBlocSize,
  getCooperationCount,
  getSaturation,
  refreshSaturationForAgency,
  refreshAllNeutralSaturation,
  evaluateProposal,
  previewProposal,
  createProposal,
  createAgreement,
  respondToProposal,
  withdrawProposal,
  terminateAgreement,
  expireProposals,
  expireAgreements,
  expireProposalById,
  expireAgreementById,
  tickNpcDiplomacy,
  ensureNpcTickScheduled,
  handleProposalExpired,
  handleAgreementExpired,
  handleNpcTick,
  listDirectory,
  listRelations,
  getRelationDetail,
  listProposals,
  listAgreements,
  getDiplomacyOverview,
  loadRelation,
  loadAgency,
  npcActionSeed,
  npcAcceptanceChance,
  ERROR_STATUS,
};
