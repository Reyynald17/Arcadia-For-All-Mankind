const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase } = require('../test-support/fakeSupabase');
const { economyRpc } = require('../test-support/economyRpc');
const { gameDaysToRealMs } = require('../src/services/gameClock');
const {
  planLaunchSchedule,
  handleRolloutComplete,
  handleLaunchIgnition,
  handleOrbitOperationsComplete,
  ROLLOUT_MIN_GAME_DAYS,
  ROLLOUT_MAX_GAME_DAYS,
} = require('../src/services/launchEngine');

const launchEvent = {
  id: 'event-launch-1',
  agency_id: 'agency-1',
  reference_id: 'mission-1',
  execute_at: '2026-11-17T12:00:00.000Z',
  payload: {
    agency_rp: 100,
    vehicle_reliability: 90,
  },
};

function createDatabase(missionStatus = 'COUNTDOWN') {
  return {
    agencies: [{
      id: 'agency-1',
      ap: 0,
      budget: 0,
      rp: 100,
      science_points: 50,
      funding_usd: 15000000,
      ipi: 60,
      si: 70,
      slr: 50,
      total_launches: 2,
      successful_launches: 1,
      launch_site_lat: 28.5,
      launch_site_lon: -80.6,
    }],
    vehicles: [{
      id: 'vehicle-1',
      agency_id: 'agency-1',
      name: 'Ariane Test',
      type: 'orbital-rocket',
      status: missionStatus === 'COUNTDOWN' ? 'assigned' : 'testing',
      reliability: 90,
      total_launches: 2,
      successful_launches: 1,
    }],
    missions: [{
      id: 'mission-1',
      agency_id: 'agency-1',
      season_id: 'season-1',
      vehicle_id: 'vehicle-1',
      name: 'Mission One',
      type: 'test',
      status: missionStatus,
      result: null,
      mission_seed: 987654321,
      scheduled_launch_at: launchEvent.execute_at,
      launch_site_lat: 28.5,
      launch_site_lon: -80.6,
      target_inclination_deg: 28.5,
      azimuth_deg: 45,
      telemetry: {},
      outcome: null,
      completed_at: null,
    }],
    logs: [],
  };
}

test('launch schedule is deterministic and follows the rollout windows', () => {
  const now = new Date('2026-11-16T00:00:00.000Z');
  const multiplier = 52.142857;
  const first = planLaunchSchedule({ missionSeed: 42, multiplier, now });
  const second = planLaunchSchedule({ missionSeed: 42, multiplier, now });

  assert.deepEqual(first, second);
  assert.ok(first.rolloutGameDays >= ROLLOUT_MIN_GAME_DAYS);
  assert.ok(first.rolloutGameDays <= ROLLOUT_MAX_GAME_DAYS);

  const rolloutMs = new Date(first.rolloutCompletesAt).getTime() - now.getTime();
  const launchMs = new Date(first.scheduledLaunchAt).getTime() - now.getTime();
  assert.ok(Math.abs(rolloutMs - gameDaysToRealMs(first.rolloutGameDays, multiplier)) < 1);
  assert.ok(launchMs > rolloutMs);
  assert.ok(
    Math.abs((launchMs - rolloutMs) - gameDaysToRealMs(first.countdownGameDays, multiplier)) < 1,
  );
});

test('ROLLOUT_COMPLETE moves a mission into countdown once', async () => {
  const { database, client } = createFakeSupabase(createDatabase('ROLLOUT'));
  const event = {
    id: 'event-rollout-1',
    agency_id: 'agency-1',
    reference_id: 'mission-1',
    execute_at: '2026-11-16T12:00:00.000Z',
    payload: {},
  };

  const first = await handleRolloutComplete(client, event);
  const second = await handleRolloutComplete(client, event);

  assert.equal(first.status, 'COUNTDOWN');
  assert.equal(first.already_completed, false);
  assert.equal(second.already_completed, true);
  assert.equal(database.missions[0].status, 'COUNTDOWN');
  assert.equal(database.logs.length, 1);
  assert.equal(database.logs[0].data.event_id, event.id);
});

test('LAUNCH_IGNITION resolves the mission deterministically and applies stats once', async () => {
  const { database, client } = createFakeSupabase(createDatabase());
  const { database: otherDatabase, client: otherClient } = createFakeSupabase(createDatabase());

  const first = await handleLaunchIgnition(client, launchEvent);
  const replay = await handleLaunchIgnition(otherClient, launchEvent);

  assert.deepEqual(first.outcome, replay.outcome);
  assert.equal(first.success, true);
  assert.equal(database.missions[0].status, 'ORBIT');
  assert.equal(database.missions[0].result, null);
  assert.ok(database.missions[0].outcome.orbit.period_seconds > 0);
  assert.equal(database.agencies[0].total_launches, 3);
  assert.equal(database.agencies[0].successful_launches, 2);
  assert.equal(database.agencies[0].rp, 110);
  assert.equal(database.agencies[0].science_points, 70);
  assert.equal(database.vehicles[0].status, 'testing');
  assert.equal(database.vehicles[0].total_launches, 3);
  assert.equal(database.logs.length, 1);
  assert.equal(database.logs[0].event_type, 'ORBIT_INSERTION');
  assert.equal(database.logs[0].data.event_id, launchEvent.id);
  assert.equal(database.scheduled_events.length, 1);
  assert.equal(database.scheduled_events[0].event_type, 'ORBIT_OPERATIONS_COMPLETE');
  assert.equal(otherDatabase.logs.length, 1);
});

test('ORBIT_OPERATIONS_COMPLETE closes an orbital mission once', async () => {
  const database = createDatabase();
  const { client } = createFakeSupabase(database, { rpc: economyRpc(database) });

  await handleLaunchIgnition(client, launchEvent);
  const orbitEvent = database.scheduled_events[0];
  const first = await handleOrbitOperationsComplete(client, orbitEvent);
  const replay = await handleOrbitOperationsComplete(client, orbitEvent);

  assert.equal(first.already_completed, false);
  assert.equal(replay.already_completed, true);
  assert.equal(database.missions[0].status, 'COMPLETED');
  assert.equal(database.missions[0].result, 'success');
  assert.equal(database.logs.length, 3);
  assert.equal(database.logs[1].event_type, 'MISSION_REWARDED');
  assert.equal(database.logs[2].event_type, 'MISSION_COMPLETED');
  assert.equal(database.logs[2].data.event_id, orbitEvent.id);
});

test('LAUNCH_IGNITION is idempotent after completion', async () => {
  const { database, client } = createFakeSupabase(createDatabase());

  await handleLaunchIgnition(client, launchEvent);
  const second = await handleLaunchIgnition(client, launchEvent);

  assert.equal(second.already_completed, true);
  assert.equal(database.agencies[0].total_launches, 3);
  assert.equal(database.vehicles[0].total_launches, 3);
  assert.equal(database.logs.length, 1);
});
