const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createFakeSupabase } = require('../test-support/fakeSupabase');
const { hashSeed, createSeededRng } = require('../src/services/seededRng');
const {
  DIPLOMACY_CONFIG,
  saturationThreshold,
  getBlocSize,
  getSaturation,
  evaluateProposal,
  previewProposal,
  createProposal,
  respondToProposal,
  withdrawProposal,
  terminateAgreement,
  expireProposals,
  listDirectory,
  listAgreements,
  getDiplomacyOverview,
  tickNpcDiplomacy,
  ensureNpcTickScheduled,
  npcActionSeed,
  npcAcceptanceChance,
} = require('../src/services/diplomacyEngine');
const diplomacyRoutes = require('../src/routes/diplomacy');

const NOW = new Date('2026-11-18T00:00:00.000Z');
const SEASON = {
  id: 'season-1',
  name: 'Season 1',
  start_real_time: '2026-11-16T00:00:00.000Z',
  epoch_game_date: '1969-07-20',
  time_scale_multiplier: 52.142857,
  status: 'ACTIVE',
};

function dayOffset(days) {
  return new Date(NOW.getTime() + days * 86400000).toISOString();
}

function makeAgency(id, overrides = {}) {
  return {
    id,
    season_id: 'season-1',
    code: id.toUpperCase(),
    name: `Agency ${id}`,
    country: 'Testland',
    alignment: 'INDEPENDENT',
    bloc: 'neutral',
    controller_type: 'npc',
    npc_profile: { profile: 'opportunistic' },
    is_active: true,
    user_id: null,
    funding_usd: 20000000,
    science_points: 1000,
    ...overrides,
  };
}

function makeAgreement(id, lowId, highId, overrides = {}) {
  return {
    id,
    season_id: 'season-1',
    party_low_id: lowId,
    party_high_id: highId,
    agreement_type: 'cooperation',
    terms: { duration_days: 30 },
    status: 'active',
    source_proposal_id: null,
    started_at: dayOffset(-10),
    ends_at: dayOffset(20),
    terminated_at: null,
    ...overrides,
  };
}

function makeProposal(id, fromId, toId, overrides = {}) {
  return {
    id,
    season_id: 'season-1',
    from_agency_id: fromId,
    to_agency_id: toId,
    proposal_type: 'cooperation',
    terms: { duration_days: 30 },
    note: null,
    status: 'pending',
    parent_proposal_id: null,
    expires_at: dayOffset(3),
    responded_at: null,
    created_at: dayOffset(-1),
    ...overrides,
  };
}

function createDatabase() {
  return {
    seasons: [{ ...SEASON }],
    agencies: [],
    agency_relations: [],
    agency_bloc_saturation: [],
    diplomatic_proposals: [],
    agency_agreements: [],
    diplomatic_events: [],
    scheduled_events: [],
  };
}

function fakeAcceptRpc(params, database) {
  const proposal = database.diplomatic_proposals.find((row) => row.id === params.p_proposal_id);
  if (!proposal) throw new Error('PROPOSAL_NOT_FOUND');
  if (proposal.to_agency_id !== params.p_actor_agency_id) throw new Error('FORBIDDEN_PROPOSAL');
  if (proposal.status !== 'pending') throw new Error('PROPOSAL_NOT_PENDING');
  if (new Date(proposal.expires_at) <= NOW) throw new Error('PROPOSAL_EXPIRED');

  const from = database.agencies.find((row) => row.id === proposal.from_agency_id);
  const to = database.agencies.find((row) => row.id === proposal.to_agency_id);
  if (!from || !to) throw new Error('AGENCY_NOT_FOUND');
  if (!from.is_active || !to.is_active) throw new Error('AGENCY_INACTIVE');

  const lowId = from.id < to.id ? from.id : to.id;
  const highId = from.id < to.id ? to.id : from.id;
  const existing = database.agency_relations.find(
    (row) => row.agency_low_id === lowId && row.agency_high_id === highId,
  );
  const score = Math.max(
    params.p_min_score,
    Math.min(params.p_max_score, (existing?.relation_score ?? params.p_initial_score) + params.p_relation_gain),
  );
  const status = score >= params.p_allied_threshold
    ? 'allied'
    : score >= params.p_cooperative_threshold ? 'cooperative' : 'neutral';
  const relation = existing || {
    id: 'relation-1',
    agency_low_id: lowId,
    agency_high_id: highId,
    relation_score: score,
    status,
  };
  Object.assign(relation, { relation_score: score, status, last_action_at: NOW.toISOString() });
  if (!existing) database.agency_relations.push(relation);

  const agreement = {
    id: 'agreement-1',
    season_id: proposal.season_id,
    party_low_id: lowId,
    party_high_id: highId,
    agreement_type: proposal.proposal_type,
    terms: proposal.terms,
    status: 'active',
    source_proposal_id: proposal.id,
    started_at: NOW.toISOString(),
    ends_at: dayOffset(30),
  };
  database.agency_agreements.push(agreement);

  proposal.status = 'accepted';
  proposal.responded_at = NOW.toISOString();
  database.diplomatic_events.push({
    id: 'event-accepted',
    season_id: proposal.season_id,
    actor_agency_id: to.id,
    counterpart_agency_id: from.id,
    event_type: 'DIPLOMACY_PROPOSAL_ACCEPTED',
    proposal_id: proposal.id,
    agreement_id: agreement.id,
    description: 'Proposal accepted.',
    data: {},
    created_at: NOW.toISOString(),
  });
  database.scheduled_events.push({
    season_id: proposal.season_id,
    agency_id: to.id,
    event_type: 'DIPLOMACY_AGREEMENT_EXPIRED',
    reference_id: agreement.id,
    payload: { agreement_id: agreement.id },
    execute_at: agreement.ends_at,
    status: 'PENDING',
  });

  return { agreement, relation };
}

test('bloc size counts only active player and NPC agencies', async () => {
  const database = createDatabase();
  database.agencies.push(
    makeAgency('west-player', { bloc: 'western', controller_type: 'player', user_id: 'user-1' }),
    makeAgency('west-npc-1', { bloc: 'western' }),
    makeAgency('west-npc-2', { bloc: 'western' }),
    makeAgency('west-inactive', { bloc: 'western', is_active: false }),
    makeAgency('east-npc-1', { bloc: 'eastern' }),
    makeAgency('neutral-npc-1', { bloc: 'neutral' }),
  );
  const { client } = createFakeSupabase(database);

  assert.equal(await getBlocSize(client, 'western', { seasonId: 'season-1' }), 3);
  assert.equal(await getBlocSize(client, 'eastern', { seasonId: 'season-1' }), 1);
  assert.equal(await getBlocSize(client, 'neutral', { seasonId: 'season-1' }), 1);
  assert.equal(saturationThreshold(20, 0.25), 5);
  assert.equal(saturationThreshold(0, 0.25), 0);
});

test('neutral saturation follows unique counterparts and the 4/20, 5/20, 6/20 boundary', async () => {
  const database = createDatabase();
  database.agencies.push(makeAgency('neutral-1', { bloc: 'neutral', controller_type: 'player', user_id: 'user-1' }));
  for (let index = 1; index <= 20; index += 1) {
    database.agencies.push(makeAgency(`west-${index}`, { bloc: 'western' }));
    database.agencies.push(makeAgency(`east-${index}`, { bloc: 'eastern' }));
  }
  for (let index = 1; index <= 4; index += 1) {
    database.agency_agreements.push(makeAgreement(`west-agreement-${index}`, `west-${index}`, 'neutral-1'));
  }
  database.agency_agreements.push(makeAgreement('west-duplicate', 'west-1', 'neutral-1'));

  const { client } = createFakeSupabase(database);
  const atFour = await getSaturation(client, 'neutral-1', 'western', { now: NOW, persist: false });
  assert.equal(atFour.blocAgencyCount, 20);
  assert.equal(atFour.counterpartCount, 4, 'duplicate agreements with one counterpart count once');
  assert.equal(atFour.threshold, 5);
  assert.equal(atFour.isSaturated, false);

  database.agency_agreements.push(makeAgreement('west-agreement-5', 'west-5', 'neutral-1'));
  const atFive = await getSaturation(client, 'neutral-1', 'western', { now: NOW, persist: false });
  assert.equal(atFive.counterpartCount, 5);
  assert.equal(atFive.isSaturated, true);

  database.agency_agreements.push(makeAgreement('west-agreement-6', 'west-6', 'neutral-1'));
  const atSix = await getSaturation(client, 'neutral-1', 'western', { now: NOW, persist: false });
  assert.equal(atSix.counterpartCount, 6);
  assert.equal(atSix.isSaturated, true);

  const eastern = await getSaturation(client, 'neutral-1', 'eastern', { now: NOW, persist: false });
  assert.equal(eastern.counterpartCount, 0);
  assert.equal(eastern.isSaturated, false, 'saturation must not leak across blocs');
});

test('saturation clears when agreements end and drops below the threshold', async () => {
  const database = createDatabase();
  database.agencies.push(makeAgency('neutral-1', { bloc: 'neutral', controller_type: 'player', user_id: 'user-1' }));
  for (let index = 1; index <= 20; index += 1) {
    database.agencies.push(makeAgency(`west-${index}`, { bloc: 'western' }));
  }
  for (let index = 1; index <= 5; index += 1) {
    database.agency_agreements.push(makeAgreement(`west-agreement-${index}`, `west-${index}`, 'neutral-1'));
  }

  const { client } = createFakeSupabase(database);
  assert.equal(
    (await getSaturation(client, 'neutral-1', 'western', { now: NOW, persist: false })).isSaturated,
    true,
  );

  database.agency_agreements[0].status = 'terminated';
  const afterTermination = await getSaturation(client, 'neutral-1', 'western', { now: NOW, persist: false });
  assert.equal(afterTermination.counterpartCount, 4);
  assert.equal(afterTermination.isSaturated, false);

  database.agency_agreements[1].status = 'active';
  database.agency_agreements[1].ends_at = dayOffset(-1);
  const afterExpiry = await getSaturation(client, 'neutral-1', 'western', { now: NOW, persist: false });
  assert.equal(afterExpiry.counterpartCount, 3);
  assert.equal(afterExpiry.isSaturated, false);
});

test('cross-bloc proposals are soft-penalised while neutral pairs are not', async () => {
  const database = createDatabase();
  database.agencies.push(
    makeAgency('west-1', { bloc: 'western', controller_type: 'player', user_id: 'user-1' }),
    makeAgency('west-2', { bloc: 'western' }),
    makeAgency('east-1', { bloc: 'eastern' }),
    makeAgency('neutral-1', { bloc: 'neutral' }),
  );
  const { client } = createFakeSupabase(database);
  const [west, westTwo, east, neutral] = database.agencies;

  const cross = await evaluateProposal(client, {
    fromAgency: west,
    toAgency: east,
    durationDays: 30,
    agreementType: 'cooperation',
    now: NOW,
    season: SEASON,
  });
  assert.equal(cross.crossBlocPenalty, true);
  assert.equal(cross.acceptance, 'low');
  assert.equal(cross.costFunding, 2625000);
  assert.equal(cross.cooldownGameDays, 5);

  const towardNeutral = await evaluateProposal(client, {
    fromAgency: west,
    toAgency: neutral,
    durationDays: 30,
    agreementType: 'cooperation',
    now: NOW,
    season: SEASON,
  });
  assert.equal(towardNeutral.crossBlocPenalty, false);
  assert.equal(towardNeutral.acceptance, 'medium');
  assert.equal(towardNeutral.costFunding, 1500000);
  assert.equal(towardNeutral.cooldownGameDays, 2);

  const sameBloc = await evaluateProposal(client, {
    fromAgency: west,
    toAgency: westTwo,
    durationDays: 30,
    agreementType: 'cooperation',
    now: NOW,
    season: SEASON,
  });
  assert.equal(sameBloc.crossBlocPenalty, false);
  assert.equal(sameBloc.acceptance, 'medium');

  const neutralOutbound = await evaluateProposal(client, {
    fromAgency: neutral,
    toAgency: west,
    durationDays: 30,
    agreementType: 'cooperation',
    now: NOW,
    season: SEASON,
  });
  assert.equal(neutralOutbound.crossBlocPenalty, false);
  assert.equal(neutralOutbound.acceptance, 'medium');
});

test('createProposal charges funding, schedules expiry, and rejects duplicates and self-targets', async () => {
  const database = createDatabase();
  database.agencies.push(
    makeAgency('west-1', { bloc: 'western', controller_type: 'player', user_id: 'user-1', funding_usd: 10000000 }),
    makeAgency('west-2', { bloc: 'western' }),
    makeAgency('west-3', { bloc: 'western' }),
  );
  const { client } = createFakeSupabase(database);

  const preview = await previewProposal(client, {
    fromAgencyId: 'west-1',
    targetAgencyId: 'west-2',
    durationDays: 30,
    agreementType: 'cooperation',
    now: NOW,
    season: SEASON,
  });
  assert.equal(preview.allowed, true);
  assert.equal(preview.acceptance, 'medium');
  assert.equal(preview.costFunding, 1500000);

  const created = await createProposal(client, {
    fromAgencyId: 'west-1',
    targetAgencyId: 'west-2',
    durationDays: 30,
    agreementType: 'cooperation',
    note: '  Joint\n telemetry   exchange  ',
    now: NOW,
    season: SEASON,
  });
  assert.equal(created.proposal.status, 'pending');
  assert.equal(created.proposal.note, 'Joint telemetry exchange');
  assert.equal(created.newFundingUsd, 8500000);
  assert.equal(created.expiryScheduled, true);
  assert.equal(database.agencies[0].funding_usd, 8500000);
  assert.equal(database.diplomatic_events[0].event_type, 'DIPLOMACY_PROPOSAL_SENT');
  assert.ok(database.scheduled_events.some((event) => (
    event.event_type === 'DIPLOMACY_PROPOSAL_EXPIRED'
    && event.reference_id === created.proposal.id
  )));

  database.agency_relations[0].cooldown_until = dayOffset(-1);
  await assert.rejects(
    createProposal(client, {
      fromAgencyId: 'west-1',
      targetAgencyId: 'west-2',
      durationDays: 30,
      agreementType: 'cooperation',
      now: NOW,
      season: SEASON,
    }),
    (error) => error.code === 'DUPLICATE_PROPOSAL',
  );

  await assert.rejects(
    createProposal(client, {
      fromAgencyId: 'west-1',
      targetAgencyId: 'west-1',
      durationDays: 30,
      agreementType: 'cooperation',
      now: NOW,
      season: SEASON,
    }),
    (error) => error.code === 'SELF_PROPOSAL',
  );

  database.agency_agreements.push(makeAgreement('existing', 'west-1', 'west-3'));
  await assert.rejects(
    createProposal(client, {
      fromAgencyId: 'west-1',
      targetAgencyId: 'west-3',
      durationDays: 30,
      agreementType: 'cooperation',
      now: NOW,
      season: SEASON,
    }),
    (error) => error.code === 'DUPLICATE_AGREEMENT',
  );

  await assert.rejects(
    previewProposal(client, {
      fromAgencyId: 'west-1',
      targetAgencyId: 'west-3',
      durationDays: 30,
      agreementType: 'cooperation',
      note: 'x'.repeat(281),
      now: NOW,
      season: SEASON,
    }),
    (error) => error.code === 'NOTE_TOO_LONG',
  );
});

test('proposal reject, withdraw, and expiry update state and audit log once', async () => {
  const database = createDatabase();
  database.agencies.push(
    makeAgency('west-1', { bloc: 'western', controller_type: 'player', user_id: 'user-1' }),
    makeAgency('west-2', { bloc: 'western' }),
    makeAgency('west-3', { bloc: 'western' }),
  );
  database.diplomatic_proposals.push(
    makeProposal('proposal-reject', 'west-2', 'west-1'),
    makeProposal('proposal-withdraw', 'west-1', 'west-3'),
    makeProposal('proposal-expire', 'west-2', 'west-3', { expires_at: dayOffset(-1) }),
  );
  const { client } = createFakeSupabase(database);

  const rejected = await respondToProposal(client, {
    proposalId: 'proposal-reject',
    actorAgencyId: 'west-1',
    action: 'reject',
    reason: 'Not this season',
    now: NOW,
    season: SEASON,
  });
  assert.equal(rejected.status, 'rejected');
  assert.equal(database.diplomatic_proposals[0].status, 'rejected');
  assert.equal(database.agency_relations[0].relation_score, 47);
  assert.equal(database.diplomatic_events[0].event_type, 'DIPLOMACY_PROPOSAL_REJECTED');

  const withdrawn = await withdrawProposal(client, {
    proposalId: 'proposal-withdraw',
    actorAgencyId: 'west-1',
    now: NOW,
  });
  assert.equal(withdrawn.status, 'withdrawn');
  assert.equal(database.diplomatic_proposals[1].status, 'withdrawn');

  const expireResult = await expireProposals(client, { now: NOW, season: SEASON });
  assert.equal(expireResult.expired, 1);
  assert.ok(database.diplomatic_proposals.some((row) => (
    row.id === 'proposal-expire' && row.status === 'expired'
  )));
  const eventCount = database.diplomatic_events.filter((event) => (
    event.event_type === 'DIPLOMACY_PROPOSAL_EXPIRED'
  )).length;
  assert.equal(eventCount, 1);

  await expireProposals(client, { now: NOW, season: SEASON });
  assert.equal(
    database.diplomatic_events.filter((event) => event.event_type === 'DIPLOMACY_PROPOSAL_EXPIRED').length,
    1,
    'expiry is idempotent',
  );
});

test('counter creates a reverse proposal and enforces the counter depth limit', async () => {
  const database = createDatabase();
  database.agencies.push(
    makeAgency('west-1', { bloc: 'western', controller_type: 'player', user_id: 'user-1', funding_usd: 10000000 }),
    makeAgency('west-2', { bloc: 'western' }),
  );
  database.diplomatic_proposals.push(makeProposal('proposal-1', 'west-2', 'west-1'));
  const { client } = createFakeSupabase(database);

  const result = await respondToProposal(client, {
    proposalId: 'proposal-1',
    actorAgencyId: 'west-1',
    action: 'counter',
    note: 'Shorter term',
    now: NOW,
    season: SEASON,
  });
  assert.equal(result.status, 'countered');
  assert.equal(result.proposal.from_agency_id, 'west-1');
  assert.equal(result.proposal.to_agency_id, 'west-2');
  assert.equal(result.proposal.parent_proposal_id, 'proposal-1');
  assert.equal(database.diplomatic_proposals[0].status, 'countered');
  assert.equal(database.agencies[0].funding_usd, 9250000);
  assert.ok(database.diplomatic_events.some((event) => (
    event.event_type === 'DIPLOMACY_PROPOSAL_COUNTERED'
  )));

  await assert.rejects(
    respondToProposal(client, {
      proposalId: result.proposal.id,
      actorAgencyId: 'west-2',
      action: 'counter',
      now: NOW,
      season: SEASON,
    }),
    (error) => error.code === 'COUNTER_LIMIT',
  );
});

test('accept creates an agreement through the RPC and termination is audited', async () => {
  const database = createDatabase();
  database.agencies.push(
    makeAgency('west-1', { bloc: 'western', controller_type: 'player', user_id: 'user-1' }),
    makeAgency('west-2', { bloc: 'western' }),
  );
  database.diplomatic_proposals.push(makeProposal('proposal-1', 'west-2', 'west-1'));
  const { client } = createFakeSupabase(database, { rpc: { accept_diplomatic_proposal: fakeAcceptRpc } });

  const accepted = await respondToProposal(client, {
    proposalId: 'proposal-1',
    actorAgencyId: 'west-1',
    action: 'accept',
    now: NOW,
    season: SEASON,
  });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.agreement.status, 'active');
  assert.equal(database.diplomatic_proposals[0].status, 'accepted');
  assert.equal(database.agency_agreements.length, 1);
  assert.equal(database.agency_relations[0].relation_score, 62);
  assert.ok(database.scheduled_events.some((event) => (
    event.event_type === 'DIPLOMACY_AGREEMENT_EXPIRED'
  )));

  const terminated = await terminateAgreement(client, {
    agreementId: 'agreement-1',
    actorAgencyId: 'west-1',
    now: NOW,
    season: SEASON,
  });
  assert.equal(terminated.agreement.status, 'terminated');
  assert.equal(database.agency_relations[0].relation_score, 50);
  assert.ok(database.diplomatic_events.some((event) => (
    event.event_type === 'DIPLOMACY_AGREEMENT_TERMINATED'
  )));

  const list = await listAgreements(client, { agencyId: 'west-1' });
  assert.equal(list.counts.terminated, 1);
});

test('only the owning player agency may act, and public payloads hide NPC internals', async () => {
  const database = createDatabase();
  database.agencies.push(
    makeAgency('west-1', {
      bloc: 'western',
      controller_type: 'player',
      user_id: 'user-1',
      name: 'Player One',
    }),
    makeAgency('west-2', {
      bloc: 'western',
      controller_type: 'player',
      user_id: 'user-2',
      name: 'Player Two',
    }),
    makeAgency('west-npc', {
      bloc: 'western',
      name: 'NPC One',
      npc_profile: { profile: 'cooperative' },
    }),
    makeAgency('west-target', { bloc: 'western', name: 'Target One' }),
  );
  const { client } = createFakeSupabase(database, { userId: 'user-1' });
  const app = express();
  app.use(express.json());
  app.use('/api/diplomacy', diplomacyRoutes(client, { now: () => NOW }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const unauthorized = await fetch(`${baseUrl}/api/diplomacy/agencies`);
    assert.equal(unauthorized.status, 401);

    const forbiddenOverview = await fetch(`${baseUrl}/api/diplomacy/overview/west-2`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    assert.equal(forbiddenOverview.status, 403);
    assert.equal((await forbiddenOverview.json()).error, 'FORBIDDEN_AGENCY');

    const forbiddenProposal = await fetch(`${baseUrl}/api/diplomacy/proposals`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agencyId: 'west-2',
        targetAgencyId: 'west-1',
        durationDays: 30,
      }),
    });
    assert.equal(forbiddenProposal.status, 403);

    const selfProposal = await fetch(`${baseUrl}/api/diplomacy/proposals`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agencyId: 'west-1',
        targetAgencyId: 'west-1',
        durationDays: 30,
      }),
    });
    assert.equal(selfProposal.status, 400);

    const directoryResponse = await fetch(`${baseUrl}/api/diplomacy/agencies`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    assert.equal(directoryResponse.status, 200);
    const directory = await directoryResponse.json();
    assert.ok(directory.agencies.some((agency) => agency.controller_type === 'npc'));
    for (const agency of directory.agencies) {
      assert.equal('npc_profile' in agency, false);
      assert.equal('user_id' in agency, false);
    }

    const configResponse = await fetch(`${baseUrl}/api/diplomacy/config`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    assert.equal(configResponse.status, 200);
    const policy = await configResponse.json();
    assert.equal(policy.noteMaxLength, 280);
    assert.equal(JSON.stringify(policy).includes('initiateChance'), false);

    const createResponse = await fetch(`${baseUrl}/api/diplomacy/proposals`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agencyId: 'west-1',
        targetAgencyId: 'west-target',
        durationDays: 60,
      }),
    });
    assert.equal(createResponse.status, 201, await createResponse.text());

    const overviewResponse = await fetch(`${baseUrl}/api/diplomacy/overview/west-1`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    assert.equal(overviewResponse.status, 200);
    const overview = await overviewResponse.json();
    assert.equal(overview.blocs.length, 3);
    assert.equal(overview.agency.id, 'west-1');
    assert.equal('npc_profile' in overview.agency, false);
    assert.equal(overview.proposals.outgoingPending, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('neutral overview exposes saturation progress for the player agency', async () => {
  const database = createDatabase();
  database.agencies.push(makeAgency('neutral-1', {
    bloc: 'neutral',
    controller_type: 'player',
    user_id: 'user-1',
  }));
  for (let index = 1; index <= 20; index += 1) {
    database.agencies.push(makeAgency(`west-${index}`, { bloc: 'western' }));
  }
  for (let index = 1; index <= 5; index += 1) {
    database.agency_agreements.push(makeAgreement(`agreement-${index}`, `west-${index}`, 'neutral-1'));
  }
  const { client } = createFakeSupabase(database);

  const overview = await getDiplomacyOverview(client, {
    agencyId: 'neutral-1',
    now: NOW,
    season: SEASON,
  });
  const western = overview.saturation.find((entry) => entry.bloc === 'western');
  assert.ok(western);
  assert.equal(western.counterpartCount, 5);
  assert.equal(western.blocAgencyCount, 20);
  assert.equal(western.threshold, 5);
  assert.equal(western.isSaturated, true);
  assert.equal(overview.blocs.find((entry) => entry.bloc === 'western').activeAgencies, 20);

  const persisted = database.agency_bloc_saturation.find((row) => row.bloc === 'western');
  assert.ok(persisted);
  assert.equal(persisted.is_saturated, true);
  assert.ok(persisted.evaluated_at);
});

test('NPC tick is deterministic and some NPCs initiate proposals', async () => {
  const database = createDatabase();
  const ids = [];
  for (let index = 0; index < 8; index += 1) {
    const id = `npc-${index}`;
    ids.push(id);
    database.agencies.push(makeAgency(id, {
      bloc: 'western',
      controller_type: 'npc',
      npc_profile: { profile: 'cooperative' },
      funding_usd: 500000000,
    }));
  }
  database.agencies.push(makeAgency('player-1', {
    bloc: 'western',
    controller_type: 'player',
    user_id: 'user-1',
    funding_usd: 50000000,
  }));

  const gameDays = ((NOW.getTime() - new Date(SEASON.start_real_time).getTime()) / 86400000)
    * SEASON.time_scale_multiplier;
  const gameDay = Math.floor(Math.max(0, gameDays));
  const gameSlot = Math.floor(Math.max(0, gameDays) * DIPLOMACY_CONFIG.npc.staggerBuckets);
  const eventId = 'tick-event-1';
  const expectedInitiators = ids.filter((id) => (
    hashSeed(id) % DIPLOMACY_CONFIG.npc.staggerBuckets === gameSlot % DIPLOMACY_CONFIG.npc.staggerBuckets
    && createSeededRng(npcActionSeed(id, gameDay, eventId, 'initiate'))()
      < DIPLOMACY_CONFIG.npc.profiles.cooperative.initiateChance
  ));
  assert.ok(expectedInitiators.length > 0, 'test setup needs at least one NPC that initiates');

  const first = createFakeSupabase(database);
  const firstResult = await tickNpcDiplomacy(first.client, { id: eventId }, {
    now: NOW,
    season: SEASON,
  });
  assert.equal(firstResult.skipped, false);
  assert.ok(firstResult.proposals >= 1, 'at least one NPC should initiate a proposal');
  assert.ok(firstResult.actions.some((action) => action.action === 'propose'));

  const secondDatabase = createDatabase();
  for (const agency of database.agencies) secondDatabase.agencies.push({ ...agency });
  const second = createFakeSupabase(secondDatabase);
  const secondResult = await tickNpcDiplomacy(second.client, { id: eventId }, {
    now: NOW,
    season: SEASON,
  });

  assert.deepEqual(secondResult.actions, firstResult.actions);
  assert.equal(secondResult.proposals, firstResult.proposals);
  assert.deepEqual(
    secondDatabase.diplomatic_proposals.map((proposal) => ({
      from: proposal.from_agency_id,
      to: proposal.to_agency_id,
    })),
    first.database.diplomatic_proposals.map((proposal) => ({
      from: proposal.from_agency_id,
      to: proposal.to_agency_id,
    })),
  );

  const repeat = await tickNpcDiplomacy(first.client, { id: eventId }, {
    now: NOW,
    season: SEASON,
  });
  assert.equal(repeat.skipped, true, 'same game slot must not run twice');
});

test('NPC responds to a player proposal through the same acceptance path', async () => {
  const database = createDatabase();
  const gameDays = ((NOW.getTime() - new Date(SEASON.start_real_time).getTime()) / 86400000)
    * SEASON.time_scale_multiplier;
  const gameSlot = Math.floor(Math.max(0, gameDays) * DIPLOMACY_CONFIG.npc.staggerBuckets);
  let npcId = null;
  for (let index = 0; index < 20; index += 1) {
    const candidate = `npc-${index}`;
    if (hashSeed(candidate) % DIPLOMACY_CONFIG.npc.staggerBuckets !== gameSlot % DIPLOMACY_CONFIG.npc.staggerBuckets) {
      continue;
    }
    const chance = npcAcceptanceChance({
      profile: DIPLOMACY_CONFIG.npc.profiles.cooperative,
      relationScore: DIPLOMACY_CONFIG.relation.initialScore,
      crossBloc: false,
      same: true,
      config: DIPLOMACY_CONFIG,
    });
    const roll = createSeededRng(npcActionSeed(candidate, Math.floor(gameDays), 'tick-event-2', 'respond:proposal-1'))();
    if (roll < chance) {
      npcId = candidate;
      break;
    }
  }
  assert.ok(npcId, 'test setup needs an NPC that accepts the proposal');

  database.agencies.push(
    makeAgency(npcId, {
      bloc: 'western',
      controller_type: 'npc',
      npc_profile: { profile: 'cooperative' },
      funding_usd: 500000000,
    }),
    makeAgency('player-1', {
      bloc: 'western',
      controller_type: 'player',
      user_id: 'user-1',
      funding_usd: 50000000,
    }),
  );
  database.diplomatic_proposals.push(makeProposal('proposal-1', 'player-1', npcId));
  const { client } = createFakeSupabase(database, { rpc: { accept_diplomatic_proposal: fakeAcceptRpc } });

  const result = await tickNpcDiplomacy(client, { id: 'tick-event-2' }, {
    now: NOW,
    season: SEASON,
  });
  assert.ok(result.actions.some((action) => action.action === 'accept'));
  assert.equal(database.diplomatic_proposals[0].status, 'accepted');
  assert.equal(database.agency_agreements.length, 1);
  assert.equal(database.agency_agreements[0].agreement_type, 'cooperation');
});

test('NPC tick scheduling is idempotent', async () => {
  const database = createDatabase();
  const { client } = createFakeSupabase(database);
  const first = await ensureNpcTickScheduled(client, { now: NOW, season: SEASON });
  const second = await ensureNpcTickScheduled(client, { now: NOW, season: SEASON });

  assert.equal(first.id, second.id);
  assert.equal(
    database.scheduled_events.filter((event) => event.event_type === 'DIPLOMACY_NPC_TICK').length,
    1,
  );
});
