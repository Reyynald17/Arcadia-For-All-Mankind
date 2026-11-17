const ALIGNMENTS = Object.freeze(['WESTERN', 'EASTERN', 'INDEPENDENT']);
const ALIGNMENT_SET = new Set(ALIGNMENTS);
const MAX_SITE_NAME_LENGTH = 80;

function blocForAlignment(alignment) {
  if (alignment === 'WESTERN') return 'western';
  if (alignment === 'EASTERN') return 'eastern';
  return 'neutral';
}

function parseCoordinate(value, min, max, label) {
  if (value === undefined || value === null || value === '') {
    return { value: null, error: null };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return { value: null, error: `${label} must be between ${min} and ${max}` };
  }
  return { value: parsed, error: null };
}

function normalizeAgencyProfile(input = {}, { requireComplete = false } = {}) {
  const rawAlignment = String(input.alignment || '').trim().toUpperCase();
  const alignmentProvided = ALIGNMENT_SET.has(rawAlignment);
  if (requireComplete && !alignmentProvided) {
    return { error: 'alignment must be WESTERN, EASTERN, or INDEPENDENT' };
  }

  const lat = parseCoordinate(input.launchSiteLat, -90, 90, 'launchSiteLat');
  if (lat.error) return { error: lat.error };

  const lon = parseCoordinate(input.launchSiteLon, -180, 180, 'launchSiteLon');
  if (lon.error) return { error: lon.error };

  const rawName = typeof input.launchSiteName === 'string' ? input.launchSiteName.trim() : '';
  if (rawName.length > MAX_SITE_NAME_LENGTH) {
    return { error: `launchSiteName must be at most ${MAX_SITE_NAME_LENGTH} characters` };
  }

  const complete = Boolean(
    alignmentProvided && rawName && lat.value !== null && lon.value !== null,
  );
  if (requireComplete && !complete) {
    return { error: 'alignment, launchSiteName, launchSiteLat, and launchSiteLon are required' };
  }

  const alignment = alignmentProvided ? rawAlignment : 'INDEPENDENT';

  return {
    profile: {
      alignment,
      bloc: blocForAlignment(alignment),
      launch_site_lat: lat.value ?? 0,
      launch_site_lon: lon.value ?? 0,
      launch_site_name: rawName || null,
      profile_complete: complete,
    },
  };
}

module.exports = {
  ALIGNMENTS,
  MAX_SITE_NAME_LENGTH,
  blocForAlignment,
  normalizeAgencyProfile,
};
