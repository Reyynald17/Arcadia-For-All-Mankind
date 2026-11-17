const test = require('node:test');
const assert = require('node:assert/strict');
const {
  planOrbit,
  subSatellitePoint,
  groundTrackSegment,
  orbitalPeriodSeconds,
  azimuthForInclination,
  stationLinks,
  buildOrbitOverview,
} = require('../src/services/orbitalEngine');

const launch = {
  missionSeed: 424242,
  missionType: 'scientific',
  inclinationDeg: 51.6,
  launchSiteLat: 28.5,
  launchSiteLon: -80.6,
  epochRealAt: '2026-11-16T00:00:00.000Z',
};

test('planOrbit is deterministic and insertion occurs over the launch site', () => {
  const first = planOrbit(launch);
  const second = planOrbit(launch);

  assert.deepEqual(first, second);
  assert.ok(first.period_seconds > 5000);
  assert.equal(first.altitude_km >= 450, true);
  assert.equal(first.altitude_km <= 650, true);

  const insertion = subSatellitePoint(first, launch.epochRealAt, 52.142857);
  assert.ok(Math.abs(insertion.lat - launch.launchSiteLat) < 1e-3);
  assert.ok(Math.abs(insertion.lon - launch.launchSiteLon) < 1e-3);
});

test('ground tracks break at the antimeridian', () => {
  const orbit = planOrbit({ ...launch, inclinationDeg: 98 });
  const periodMs = (orbit.period_seconds * 1000) / 52.142857;
  const start = new Date(launch.epochRealAt).getTime();
  const points = groundTrackSegment(orbit, start, start + 3 * periodMs, 52.142857, 400);

  assert.ok(points.length > 100);
  assert.ok(points.some((point) => point.break === true));
});

test('launch azimuth and orbital period follow the geometry', () => {
  assert.equal(azimuthForInclination(0, 0), 90);
  assert.equal(Math.abs(azimuthForInclination(28.5, 28.5) - 90), 0);
  assert.ok(azimuthForInclination(0, 51.6) > 0);
  assert.ok(Math.abs(
    orbitalPeriodSeconds(400) - 2 * Math.PI * Math.sqrt((6371 + 400) ** 3 / 398600.4418),
  ) < 1e-6);
});

test('station links resolve line-of-sight visibility', () => {
  const orbit = planOrbit({ ...launch, inclinationDeg: 28.5, epochRealAt: launch.epochRealAt });
  const sat = subSatellitePoint(orbit, launch.epochRealAt, 52.142857);
  const links = stationLinks(sat, [
    { code: 'LOCAL', name: 'Local', lat: sat.lat, lon: sat.lon, min_elevation_deg: 5, asset_type: 'GROUND', faction: 'NEUTRAL' },
    { code: 'FAR', name: 'Far', lat: -sat.lat, lon: (sat.lon + 180) % 360, min_elevation_deg: 5, asset_type: 'GROUND', faction: 'NEUTRAL' },
  ]);

  assert.equal(links[0].code, 'LOCAL');
  assert.equal(links[0].visible, true);
  assert.equal(links[1].visible, false);
});

test('orbit overview exposes current, historical, and predicted tracks with link status', () => {
  const orbit = planOrbit({ ...launch, epochRealAt: new Date(Date.now() - 3600000).toISOString() });
  const now = new Date();
  const overview = buildOrbitOverview({
    agency: { id: 'agency-1', launch_site_lat: 28.5, launch_site_lon: -80.6 },
    missions: [{
      id: 'mission-1',
      name: 'Science One',
      type: 'scientific',
      status: 'ORBIT',
      vehicle_id: 'vehicle-1',
      mission_seed: 424242,
      launched_at: orbit.epoch_real_at,
      target_inclination_deg: 51.6,
      launch_site_lat: 28.5,
      launch_site_lon: -80.6,
      outcome: { orbit },
      telemetry: {},
    }],
    stations: [{
      code: 'GDS_CAPE',
      name: 'Cape Canaveral',
      lat: 28.572,
      lon: -80.649,
      min_elevation_deg: 5,
      asset_type: 'GROUND',
      faction: 'WESTERN',
      active: true,
    }],
    multiplier: 52.142857,
    now,
  });

  const mission = overview.missions[0];
  assert.ok(mission.orbit.period_seconds > 0);
  assert.ok(mission.current.lat >= -90 && mission.current.lat <= 90);
  assert.ok(mission.history.length > 10);
  assert.ok(mission.predicted.length > 10);
  assert.ok(['ACQUIRED', 'BLACKOUT'].includes(mission.link.status));
});
