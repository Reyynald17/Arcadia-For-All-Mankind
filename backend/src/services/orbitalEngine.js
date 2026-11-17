const { createSeededRng } = require('./seededRng');

const EARTH_RADIUS_KM = 6371;
const MU_KM3_S2 = 398600.4418;
const EARTH_ROTATION_RAD_S = 7.2921159e-5;
const TWO_PI = Math.PI * 2;

const ORBIT_ALTITUDE_BANDS_KM = Object.freeze({
  test: [220, 320],
  scientific: [450, 650],
  manned: [300, 420],
  colonial: [500, 800],
});

const ORBIT_OPERATIONS_GAME_DAYS = Object.freeze({
  test: 30,
  scientific: 180,
  manned: 90,
  colonial: 365,
});

function toRadians(degrees) {
  return (Number(degrees) * Math.PI) / 180;
}

function toDegrees(radians) {
  return (Number(radians) * 180) / Math.PI;
}

function wrap180(degrees) {
  let value = Number(degrees) % 360;
  if (value > 180) value -= 360;
  if (value < -180) value += 360;
  return value;
}

function wrap360(degrees) {
  const value = Number(degrees) % 360;
  return value < 0 ? value + 360 : value;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits));
}

function orbitalPeriodSeconds(altitudeKm) {
  const semiMajor = EARTH_RADIUS_KM + Math.max(0, Number(altitudeKm) || 0);
  return TWO_PI * Math.sqrt(semiMajor ** 3 / MU_KM3_S2);
}

function altitudeBandForType(missionType) {
  return ORBIT_ALTITUDE_BANDS_KM[missionType] || ORBIT_ALTITUDE_BANDS_KM.test;
}

function azimuthForInclination(launchLatDeg, inclinationDeg) {
  const lat = toRadians(Math.abs(Number(launchLatDeg) || 0));
  const inc = toRadians(Number(inclinationDeg) || 0);
  const denominator = Math.cos(lat);
  if (Math.abs(denominator) < 1e-9) return 90;
  const ratio = Math.cos(inc) / denominator;
  if (Math.abs(ratio) > 1) return null;
  return round(wrap360(toDegrees(Math.asin(ratio))), 2);
}

function planOrbit({
  missionSeed,
  missionType = 'test',
  inclinationDeg,
  launchSiteLat,
  launchSiteLon,
  epochRealAt,
}) {
  const rng = createSeededRng(`orbit:${missionSeed}:${missionType}`);
  const [minAltitude, maxAltitude] = altitudeBandForType(missionType);
  const altitudeKm = Math.round(minAltitude + rng() * (maxAltitude - minAltitude));
  const inclination = clamp(
    Number(inclinationDeg) || Math.abs(Number(launchSiteLat) || 0),
    0,
    180,
  );
  const latitude = clamp(Number(launchSiteLat) || 0, -90, 90);
  const longitude = wrap180(Number(launchSiteLon) || 0);
  const incRad = toRadians(inclination);
  const latRad = toRadians(latitude);
  const sinInc = Math.sin(incRad);

  const argumentOfLatitude =
    Math.abs(sinInc) < 1e-9
      ? 0
      : Math.asin(clamp(Math.sin(latRad) / sinInc, -1, 1));
  const inertialLongitude =
    longitude
    - toDegrees(
      Math.atan2(
        Math.cos(incRad) * Math.sin(argumentOfLatitude),
        Math.cos(argumentOfLatitude),
      ),
    );

  return {
    altitude_km: altitudeKm,
    semi_major_axis_km: round(EARTH_RADIUS_KM + altitudeKm, 3),
    inclination_deg: round(inclination, 3),
    raan_deg: round(wrap360(inertialLongitude), 6),
    argument_of_latitude_deg: round(toDegrees(argumentOfLatitude), 6),
    period_seconds: round(orbitalPeriodSeconds(altitudeKm), 3),
    epoch_real_at: epochRealAt || new Date().toISOString(),
  };
}

function orbitPeriodRealMs(orbit, multiplier) {
  const scale = Number(multiplier) > 0 ? Number(multiplier) : 52.142857;
  return (Number(orbit.period_seconds) * 1000) / scale;
}

function subSatellitePoint(orbit, realTime, multiplier) {
  const scale = Number(multiplier) > 0 ? Number(multiplier) : 52.142857;
  const epochMs = new Date(orbit.epoch_real_at || Date.now()).getTime();
  const currentMs = new Date(realTime).getTime();
  const gameSeconds = ((currentMs - epochMs) / 1000) * scale;
  const incRad = toRadians(orbit.inclination_deg);
  const u =
    toRadians(orbit.argument_of_latitude_deg || 0)
    + (TWO_PI / Number(orbit.period_seconds || orbitalPeriodSeconds(orbit.altitude_km)))
      * gameSeconds;

  const latitude = Math.asin(clamp(Math.sin(incRad) * Math.sin(u), -1, 1));
  const inertialLon =
    toRadians(orbit.raan_deg || 0)
    + Math.atan2(Math.cos(incRad) * Math.sin(u), Math.cos(u));
  const longitude = inertialLon - EARTH_ROTATION_RAD_S * gameSeconds;

  return {
    lat: round(toDegrees(latitude), 6),
    lon: round(wrap180(toDegrees(longitude)), 6),
    altitude_km: round(orbit.altitude_km, 3),
  };
}

function appendTrackPoint(points, lat, lon) {
  const previous = [...points].reverse().find((point) => !point.break);
  if (previous && Math.abs(lon - previous.lon) > 180) {
    points.push({ break: true });
  }
  points.push({ lat: round(lat, 5), lon: round(lon, 5) });
}

function groundTrackSegment(orbit, fromMs, toMs, multiplier, steps = 160) {
  const points = [];
  const span = Math.max(1, Number(toMs) - Number(fromMs));
  const count = Math.max(2, Math.floor(Number(steps) || 160));

  for (let index = 0; index <= count; index += 1) {
    const at = Number(fromMs) + (span * index) / count;
    const point = subSatellitePoint(orbit, new Date(at), multiplier);
    appendTrackPoint(points, point.lat, point.lon);
  }

  return points;
}

function visibilityCentralAngleDeg(altitudeKm, minElevationDeg) {
  const satelliteRadius = EARTH_RADIUS_KM + Math.max(0, Number(altitudeKm) || 0);
  const horizon = Math.acos(clamp(EARTH_RADIUS_KM / satelliteRadius, -1, 1));
  const floor = toRadians(clamp(Number(minElevationDeg) || 0, 0, 90));
  return Math.max(0, toDegrees(horizon - floor));
}

function groundDistanceDeg(latA, lonA, latB, lonB) {
  const phi1 = toRadians(latA);
  const phi2 = toRadians(latB);
  const deltaLon = toRadians(lonB - lonA);
  const cosine =
    Math.sin(phi1) * Math.sin(phi2)
    + Math.cos(phi1) * Math.cos(phi2) * Math.cos(deltaLon);
  return toDegrees(Math.acos(clamp(cosine, -1, 1)));
}

function stationLinks(satellite, stations) {
  const radius = visibilityCentralAngleDeg(
    satellite.altitude_km,
    0,
  );

  return (stations || [])
    .map((station) => {
      const distance = groundDistanceDeg(
        satellite.lat,
        satellite.lon,
        Number(station.lat),
        Number(station.lon),
      );
      const threshold = Math.max(
        0,
        radius - Math.max(0, Number(station.min_elevation_deg) || 0),
      );
      return {
        code: station.code,
        name: station.name,
        asset_type: station.asset_type,
        faction: station.faction,
        central_angle_deg: round(distance, 2),
        visibility_radius_deg: round(threshold, 2),
        visible: distance <= threshold,
      };
    })
    .sort((a, b) => a.central_angle_deg - b.central_angle_deg);
}

function destinationPoint(latDeg, lonDeg, bearingDeg, distanceKm) {
  const angular = Number(distanceKm) / EARTH_RADIUS_KM;
  const bearing = toRadians(bearingDeg);
  const lat = toRadians(latDeg);
  const lon = toRadians(lonDeg);

  const destLat = Math.asin(
    Math.sin(lat) * Math.cos(angular)
    + Math.cos(lat) * Math.sin(angular) * Math.cos(bearing),
  );
  const destLon =
    lon
    + Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat),
      Math.cos(angular) - Math.sin(lat) * Math.sin(destLat),
    );

  return { lat: round(toDegrees(destLat), 5), lon: round(wrap180(toDegrees(destLon)), 5) };
}

function trajectoryPoints(latDeg, lonDeg, azimuthDeg, maxDistanceKm = 1500) {
  const points = [];
  const bearing = Number(azimuthDeg);
  if (!Number.isFinite(bearing)) return points;

  for (let distance = 0; distance <= maxDistanceKm; distance += 100) {
    const point = destinationPoint(latDeg, lonDeg, bearing, distance);
    points.push({ ...point, downrange_km: distance });
  }
  return points;
}

function stageDropZones(latDeg, lonDeg, azimuthDeg, missionType) {
  const bearing = Number(azimuthDeg);
  if (!Number.isFinite(bearing)) return [];

  const longRange = ['scientific', 'manned', 'colonial'].includes(missionType);
  const zones = [
    { label: 'BOOSTER', downrange_km: 180, radius_km: 55 },
    {
      label: 'FIRST STAGE',
      downrange_km: longRange ? 900 : 550,
      radius_km: longRange ? 140 : 90,
    },
  ];

  return zones.map((zone) => {
    const center = destinationPoint(latDeg, lonDeg, bearing, zone.downrange_km);
    const radiusLat = round(zone.radius_km / 111.32, 3);
    const radiusLon = round(
      zone.radius_km / Math.max(1, 111.32 * Math.cos(toRadians(center.lat))),
      3,
    );
    return {
      ...zone,
      lat: center.lat,
      lon: center.lon,
      radius_lat_deg: radiusLat,
      radius_lon_deg: radiusLon,
    };
  });
}

function missionLaunchSite(mission, agency) {
  return {
    lat: Number(mission.launch_site_lat ?? agency?.launch_site_lat ?? 0),
    lon: Number(mission.launch_site_lon ?? agency?.launch_site_lon ?? 0),
    name: agency?.launch_site_name || null,
  };
}

function normalizeOrbit(rawOrbit, mission, agency) {
  if (!rawOrbit) return null;
  const epochRealAt =
    rawOrbit.epoch_real_at
    || mission.launched_at
    || mission.scheduled_launch_at
    || new Date().toISOString();
  return {
    altitude_km: Number(rawOrbit.altitude_km),
    semi_major_axis_km: Number(
      rawOrbit.semi_major_axis_km
      ?? EARTH_RADIUS_KM + Number(rawOrbit.altitude_km || 0),
    ),
    inclination_deg: Number(rawOrbit.inclination_deg),
    raan_deg: Number(rawOrbit.raan_deg || 0),
    argument_of_latitude_deg: Number(rawOrbit.argument_of_latitude_deg || 0),
    period_seconds: Number(
      rawOrbit.period_seconds || orbitalPeriodSeconds(rawOrbit.altitude_km),
    ),
    epoch_real_at: epochRealAt,
    launch_site_lat: mission.launch_site_lat ?? agency?.launch_site_lat ?? null,
    launch_site_lon: mission.launch_site_lon ?? agency?.launch_site_lon ?? null,
  };
}

function buildMissionOverview({ mission, agency, stations, multiplier, now }) {
  const nowMs = new Date(now).getTime();
  const site = missionLaunchSite(mission, agency);
  const targetInclination = Number(
    mission.target_inclination_deg ?? Math.abs(site.lat),
  );
  const azimuth = Number.isFinite(Number(mission.azimuth_deg))
    ? Number(mission.azimuth_deg)
    : azimuthForInclination(site.lat, targetInclination);

  const overview = {
    id: mission.id,
    name: mission.name,
    type: mission.type,
    status: mission.status,
    vehicle_id: mission.vehicle_id,
    launched_at: mission.launched_at || null,
    scheduled_launch_at: mission.scheduled_launch_at || null,
    mission_seed: mission.mission_seed ?? null,
    launch_site: site,
    target_inclination_deg: round(targetInclination, 3),
    azimuth_deg: azimuth === null ? null : round(azimuth, 2),
    orbit: null,
    current: null,
    history: [],
    predicted: [],
    trajectory: [],
    drop_zones: [],
    link: { status: 'NO SIGNAL', stations: [] },
  };

  if (mission.status === 'ORBIT') {
    const orbit = normalizeOrbit(
      mission.outcome?.orbit
        || planOrbit({
          missionSeed: mission.mission_seed ?? mission.id,
          missionType: mission.type,
          inclinationDeg: targetInclination,
          launchSiteLat: site.lat,
          launchSiteLon: site.lon,
          epochRealAt: mission.launched_at || now,
        }),
      mission,
      agency,
    );
    const periodRealMs = orbitPeriodRealMs(orbit, multiplier);
    const epochMs = new Date(orbit.epoch_real_at).getTime();
    const historyStart = Math.max(epochMs, nowMs - 2 * periodRealMs);

    overview.orbit = orbit;
    overview.current = subSatellitePoint(orbit, new Date(nowMs), multiplier);
    overview.history = groundTrackSegment(
      orbit,
      historyStart,
      nowMs,
      multiplier,
      120,
    );
    overview.predicted = groundTrackSegment(
      orbit,
      nowMs,
      nowMs + 2 * periodRealMs,
      multiplier,
      160,
    );

    const links = stationLinks(overview.current, stations);
    overview.link = {
      status: links.some((link) => link.visible) ? 'ACQUIRED' : 'BLACKOUT',
      stations: links,
    };
    overview.trajectory = trajectoryPoints(site.lat, site.lon, azimuth, 600);
    return overview;
  }

  if (['ROLLOUT', 'COUNTDOWN', 'ASCENT', 'PLANNED'].includes(mission.status)) {
    overview.trajectory = trajectoryPoints(site.lat, site.lon, azimuth, 1500);
    overview.drop_zones = stageDropZones(site.lat, site.lon, azimuth, mission.type);
  }

  return overview;
}

function buildOrbitOverview({ agency, missions, stations, multiplier, now = new Date() }) {
  const nowIso = new Date(now).toISOString();
  return {
    now: nowIso,
    multiplier: Number(multiplier) || 52.142857,
    agency: {
      id: agency?.id || null,
      name: agency?.name || null,
      launch_site: {
        lat: Number(agency?.launch_site_lat ?? 0),
        lon: Number(agency?.launch_site_lon ?? 0),
        name: agency?.launch_site_name || null,
      },
    },
    stations: (stations || [])
      .filter((station) => station.active !== false)
      .map((station) => ({
        id: station.id,
        code: station.code,
        name: station.name,
        lat: Number(station.lat),
        lon: Number(station.lon),
        min_elevation_deg: Number(station.min_elevation_deg),
        asset_type: station.asset_type,
        faction: station.faction,
        altitude_km: Number(station.altitude_km || 0),
        visibility_radius_deg: round(
          visibilityCentralAngleDeg(
            station.asset_type === 'RELAY' ? station.altitude_km : 500,
            station.min_elevation_deg,
          ),
          2,
        ),
      })),
    missions: (missions || []).map((mission) => buildMissionOverview({
      mission,
      agency,
      stations,
      multiplier,
      now: nowIso,
    })),
  };
}

function orbitOperationsGameDays(missionType) {
  return ORBIT_OPERATIONS_GAME_DAYS[missionType] || ORBIT_OPERATIONS_GAME_DAYS.test;
}

module.exports = {
  EARTH_RADIUS_KM,
  MU_KM3_S2,
  EARTH_ROTATION_RAD_S,
  ORBIT_ALTITUDE_BANDS_KM,
  ORBIT_OPERATIONS_GAME_DAYS,
  toRadians,
  toDegrees,
  wrap180,
  wrap360,
  orbitalPeriodSeconds,
  azimuthForInclination,
  planOrbit,
  subSatellitePoint,
  groundTrackSegment,
  visibilityCentralAngleDeg,
  groundDistanceDeg,
  stationLinks,
  destinationPoint,
  trajectoryPoints,
  stageDropZones,
  buildOrbitOverview,
  orbitOperationsGameDays,
};
