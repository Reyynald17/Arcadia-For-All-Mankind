import { ALIGNMENTS, CUSTOM_SITE_ID, LAUNCH_SITES, matchLaunchSiteId } from '../lib/agencyProfile'

const PANEL_LABEL = 'flex flex-col gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-400'
const PANEL_INPUT = 'h-9 w-full border border-carbon-border bg-carbon-bg px-2.5 text-xs normal-case tracking-normal text-neutral-100 outline-none focus:border-flight-amber'
const PANEL_HINT = 'text-[9px] normal-case tracking-normal text-neutral-400 leading-snug'

export default function AgencyProfileFields({
  form,
  onChange,
  variant = 'panel',
  alignmentLocked = false,
  disabled = false,
}) {
  const isAuth = variant === 'auth'
  const fieldClass = isAuth ? 'auth-field' : PANEL_LABEL
  const inputClass = isAuth ? '' : PANEL_INPUT
  const hintClass = isAuth ? 'auth-hint' : PANEL_HINT
  const selectedAlignment = ALIGNMENTS.find((item) => item.value === form.alignment)
  const hasSite = Boolean(form.launchSiteName || form.launchSiteLat || form.launchSiteLon)
  const presetId = hasSite ? matchLaunchSiteId(form.launchSiteLat, form.launchSiteLon) : ''

  const update = (patch) => onChange({ ...form, ...patch })

  const handlePresetChange = (event) => {
    const id = event.target.value
    if (id === '') {
      update({ launchSiteName: '', launchSiteLat: '', launchSiteLon: '' })
      return
    }
    const preset = LAUNCH_SITES.find((item) => item.id === id)
    if (!preset) return
    update({
      launchSiteName: preset.name,
      launchSiteLat: String(preset.lat),
      launchSiteLon: String(preset.lon),
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <label className={fieldClass}>
        Alignment
        <select
          value={form.alignment}
          onChange={(event) => update({ alignment: event.target.value })}
          disabled={disabled || alignmentLocked}
          required
          className={inputClass}
          style={{ colorScheme: 'dark' }}
        >
          <option value="">Pilih alignment...</option>
          {ALIGNMENTS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <span className={hintClass}>
          {alignmentLocked
            ? 'Alignment terkunci dan tidak dapat diubah.'
            : selectedAlignment?.description || 'Alignment menentukan bloc diplomasi dan terkunci setelah disimpan.'}
        </span>
      </label>

      <label className={fieldClass}>
        Lokasi Peluncuran
        <select
          value={presetId}
          onChange={handlePresetChange}
          disabled={disabled}
          className={inputClass}
          style={{ colorScheme: 'dark' }}
        >
          <option value="">Pilih lokasi...</option>
          {LAUNCH_SITES.map((site) => (
            <option key={site.id} value={site.id}>
              {site.label}
            </option>
          ))}
          <option value={CUSTOM_SITE_ID} disabled={!hasSite}>
            Custom coordinates (isi manual)
          </option>
        </select>
      </label>

      <label className={fieldClass}>
        Nama Launch Site
        <input
          type="text"
          value={form.launchSiteName}
          onChange={(event) => update({ launchSiteName: event.target.value })}
          placeholder="Contoh: Cape Meridian LC-39B"
          maxLength={80}
          disabled={disabled}
          required
          className={inputClass}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className={fieldClass}>
          Latitude
          <input
            type="number"
            value={form.launchSiteLat}
            onChange={(event) => update({ launchSiteLat: event.target.value })}
            placeholder="-90 s/d 90"
            min="-90"
            max="90"
            step="any"
            disabled={disabled}
            required
            className={inputClass}
          />
        </label>

        <label className={fieldClass}>
          Longitude
          <input
            type="number"
            value={form.launchSiteLon}
            onChange={(event) => update({ launchSiteLon: event.target.value })}
            placeholder="-180 s/d 180"
            min="-180"
            max="180"
            step="any"
            disabled={disabled}
            required
            className={inputClass}
          />
        </label>
      </div>
    </div>
  )
}
