const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_SITE_NAME_LENGTH,
  blocForAlignment,
  normalizeAgencyProfile,
} = require('../src/services/agencyProfile');

const completeInput = {
  alignment: 'WESTERN',
  launchSiteName: 'Cape Meridian',
  launchSiteLat: '5.24',
  launchSiteLon: '-52.77',
};

test('alignment maps to diplomacy bloc', () => {
  assert.equal(blocForAlignment('WESTERN'), 'western');
  assert.equal(blocForAlignment('EASTERN'), 'eastern');
  assert.equal(blocForAlignment('INDEPENDENT'), 'neutral');
});

test('complete profile normalizes numbers and marks profile complete', () => {
  const { profile, error } = normalizeAgencyProfile(completeInput, { requireComplete: true });

  assert.equal(error, undefined);
  assert.deepEqual(profile, {
    alignment: 'WESTERN',
    bloc: 'western',
    launch_site_lat: 5.24,
    launch_site_lon: -52.77,
    launch_site_name: 'Cape Meridian',
    profile_complete: true,
  });
});

test('missing profile falls back to independent defaults', () => {
  const { profile } = normalizeAgencyProfile({});

  assert.equal(profile.alignment, 'INDEPENDENT');
  assert.equal(profile.bloc, 'neutral');
  assert.equal(profile.profile_complete, false);
  assert.equal(profile.launch_site_lat, 0);
  assert.equal(profile.launch_site_lon, 0);
  assert.equal(profile.launch_site_name, null);
});

test('requireComplete rejects missing alignment or site', () => {
  assert.ok(normalizeAgencyProfile({}, { requireComplete: true }).error);
  assert.ok(
    normalizeAgencyProfile({ ...completeInput, alignment: 'MARTIAN' }, { requireComplete: true }).error,
  );
});

test('coordinates outside valid ranges are rejected', () => {
  assert.match(normalizeAgencyProfile({ launchSiteLat: 91 }).error, /launchSiteLat/);
  assert.match(normalizeAgencyProfile({ launchSiteLat: -91 }).error, /launchSiteLat/);
  assert.match(normalizeAgencyProfile({ launchSiteLon: 181 }).error, /launchSiteLon/);
  assert.match(normalizeAgencyProfile({ launchSiteLon: -181 }).error, /launchSiteLon/);
});

test('launch site name length is capped', () => {
  const longName = 'A'.repeat(MAX_SITE_NAME_LENGTH + 1);
  assert.match(normalizeAgencyProfile({ launchSiteName: longName }).error, /launchSiteName/);
});
