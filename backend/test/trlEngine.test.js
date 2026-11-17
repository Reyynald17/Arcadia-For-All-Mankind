const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase } = require('../test-support/fakeSupabase');
const {
  xpRequired,
  failureProbability,
  calculateXpGain,
  advanceTrl,
  handleStaticFire,
} = require('../src/services/trlEngine');

function createDatabase() {
  return {
    technologies: [{
      node_id: 'PROP_TEST',
      name: 'Test Engine',
      unlock_trl: 4,
      max_trl: 9,
      base_failure_rate: 0.15,
      min_failure_rate: 0.008,
    }],
    agency_tech_nodes: [{
      id: 'node-row-1',
      agency_id: 'agency-1',
      node_id: 'PROP_TEST',
      status: 'UNLOCKED',
      current_trl: 4,
      trl_xp: 0,
      total_activations: 0,
      failures_recorded: 0,
    }],
    logs: [],
  };
}

const staticFireEvent = {
  id: 'event-static-1',
  agency_id: 'agency-1',
  reference_id: 'PROP_TEST',
  execute_at: '2026-11-17T00:00:00.000Z',
  payload: { burn_seconds: 180, rated_seconds: 180 },
};

test('failure probability follows the TRL decay curve', () => {
  const atUnlock = failureProbability({
    currentTrl: 4,
    unlockTrl: 4,
    baseFailureRate: 0.15,
    minFailureRate: 0.008,
  });
  const atNine = failureProbability({
    currentTrl: 9,
    unlockTrl: 4,
    baseFailureRate: 0.15,
    minFailureRate: 0.008,
  });

  assert.ok(Math.abs(atUnlock - 0.15) < 1e-9);
  assert.ok(atNine > 0.008);
  assert.ok(atNine < atUnlock);
});

test('XP requirements grow geometrically from TRL 4', () => {
  assert.equal(xpRequired(4), 100);
  assert.equal(xpRequired(5), 160);
  assert.equal(Math.round(xpRequired(6)), 256);
});

test('XP gain weights environment, burn duration, and failure telemetry', () => {
  assert.equal(calculateXpGain({
    environmentWeight: 1,
    burnSeconds: 0,
    ratedSeconds: 180,
    outcome: 'SUCCESS',
  }), 1);
  assert.equal(calculateXpGain({
    environmentWeight: 1,
    burnSeconds: 180,
    ratedSeconds: 180,
    outcome: 'SUCCESS',
  }), 2);
  assert.equal(calculateXpGain({
    environmentWeight: 1,
    burnSeconds: 180,
    ratedSeconds: 180,
    outcome: 'FAILURE_TELEMETRY',
  }), 3);
});

test('advanceTrl rolls over XP into multiple levels', () => {
  const progression = advanceTrl({
    currentTrl: 4,
    trlXp: 90,
    gainedXp: 80,
    maxTrl: 9,
  });

  assert.equal(progression.current_trl, 5);
  assert.equal(progression.trl_xp, 70);
  assert.equal(progression.levels_gained, 1);
  assert.equal(progression.next_level_xp, 160);
});

test('static fire applies XP once and records telemetry idempotently', async () => {
  const { database, client } = createFakeSupabase(createDatabase());
  const { database: otherDatabase, client: otherClient } = createFakeSupabase(createDatabase());

  const first = await handleStaticFire(client, staticFireEvent);
  const replay = await handleStaticFire(otherClient, staticFireEvent);

  assert.equal(first.already_completed, false);
  assert.deepEqual(
    { outcome: first.outcome, xp: first.xp_gained, trl: first.current_trl },
    { outcome: replay.outcome, xp: replay.xp_gained, trl: replay.current_trl },
  );
  assert.equal(database.agency_tech_nodes[0].total_activations, 1);
  assert.ok(database.agency_tech_nodes[0].trl_xp > 0);
  assert.equal(database.logs.length, 1);
  assert.equal(database.logs[0].event_type, 'STATIC_FIRE_COMPLETE');
  assert.equal(database.logs[0].data.event_id, staticFireEvent.id);

  const second = await handleStaticFire(client, staticFireEvent);
  assert.equal(second.already_completed, true);
  assert.equal(database.agency_tech_nodes[0].total_activations, 1);
  assert.equal(database.logs.length, 1);
  assert.equal(otherDatabase.agency_tech_nodes[0].total_activations, 1);
});
