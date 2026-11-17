export const ALIGNMENTS = [
  {
    value: 'WESTERN',
    label: 'Western',
    description: 'Bloc Barat. Diplomasi lebih mudah dengan agensi Western.',
  },
  {
    value: 'EASTERN',
    label: 'Eastern',
    description: 'Bloc Timur. Diplomasi lebih mudah dengan agensi Eastern.',
  },
  {
    value: 'INDEPENDENT',
    label: 'Independent',
    description: 'Non-blok. Fleksibel, tetapi tidak punya sekutu alami.',
  },
]

export const LAUNCH_SITES = [
  {
    id: 'kourou',
    label: 'Kourou, French Guiana',
    name: 'Guiana Space Centre',
    lat: 5.24,
    lon: -52.77,
  },
  {
    id: 'tanegashima',
    label: 'Tanegashima, Japan',
    name: 'Tanegashima Space Center',
    lat: 30.4,
    lon: 130.97,
  },
  {
    id: 'sriharikota',
    label: 'Sriharikota, India',
    name: 'Satish Dhawan Space Centre',
    lat: 13.72,
    lon: 80.23,
  },
  {
    id: 'alcantara',
    label: 'Alcantara, Brazil',
    name: 'Alcantara Launch Center',
    lat: -2.37,
    lon: -44.4,
  },
  {
    id: 'biak',
    label: 'Biak, Indonesia',
    name: 'Biak Spaceport',
    lat: -1.18,
    lon: 136.1,
  },
]

export const CUSTOM_SITE_ID = 'custom'

const ALIGNMENT_VALUES = new Set(ALIGNMENTS.map((item) => item.value))

export function matchLaunchSiteId(lat, lon) {
  const latitude = Number(lat)
  const longitude = Number(lon)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return ''
  const site = LAUNCH_SITES.find(
    (item) => Math.abs(item.lat - latitude) < 0.2 && Math.abs(item.lon - longitude) < 0.2,
  )
  return site ? site.id : CUSTOM_SITE_ID
}

export function createProfileFormState(agency = {}) {
  const complete = Boolean(agency.profile_complete)
  const hasSite = Boolean(agency.launch_site_name)

  return {
    alignment: complete && ALIGNMENT_VALUES.has(agency.alignment) ? agency.alignment : '',
    launchSiteName: hasSite ? agency.launch_site_name : '',
    launchSiteLat: hasSite && agency.launch_site_lat != null ? String(agency.launch_site_lat) : '',
    launchSiteLon: hasSite && agency.launch_site_lon != null ? String(agency.launch_site_lon) : '',
  }
}

export function serializeProfileForm(form) {
  return {
    alignment: form.alignment,
    launchSiteName: String(form.launchSiteName || '').trim(),
    launchSiteLat: form.launchSiteLat === '' ? null : Number(form.launchSiteLat),
    launchSiteLon: form.launchSiteLon === '' ? null : Number(form.launchSiteLon),
  }
}

export function validateProfileForm(form) {
  if (!ALIGNMENT_VALUES.has(form.alignment)) {
    return 'Pilih alignment agensi terlebih dahulu.'
  }
  if (!String(form.launchSiteName || '').trim()) {
    return 'Nama launch site wajib diisi.'
  }
  const lat = Number(form.launchSiteLat)
  if (form.launchSiteLat === '' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return 'Latitude harus berupa angka antara -90 dan 90.'
  }
  const lon = Number(form.launchSiteLon)
  if (form.launchSiteLon === '' || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    return 'Longitude harus berupa angka antara -180 dan 180.'
  }
  return ''
}

export function alignmentLabel(value) {
  return ALIGNMENTS.find((item) => item.value === value)?.label || 'Belum dipilih'
}
