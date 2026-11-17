import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import './Dashboard.css'

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8787/api').replace(/\/$/, '')
const KEY_STORAGE = 'afm_gm_key'
const DAY_MS = 86400000
const PRESETS = [1, 7, 30, 90, 365]

const EVENT_LABELS = {
  PRODUCTION_COMPLETE: 'Produksi selesai',
  ROLLOUT_COMPLETE: 'Rollout selesai',
  LAUNCH_IGNITION: 'Ignition / peluncuran',
  ORBIT_OPERATIONS_COMPLETE: 'Operasi orbit selesai',
  TECH_COMPLETE: 'Riset selesai',
  STATIC_FIRE: 'Static fire selesai',
  DIPLOMACY_PROPOSAL_EXPIRED: 'Proposal diplomasi kedaluwarsa',
  DIPLOMACY_AGREEMENT_EXPIRED: 'Agreement diplomasi berakhir',
  DIPLOMACY_NPC_TICK: 'NPC diplomacy tick',
}

const pad = (value) => String(value).padStart(2, '0')

function toUpper(value) {
  return String(value ?? '').toUpperCase()
}

function formatUsd(value) {
  const amount = Number(value) || 0
  if (amount >= 1000000000) return `$${(amount / 1000000000).toFixed(2)}B`
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`
  if (amount >= 1000) return `$${Math.round(amount / 1000)}K`
  return `$${Math.round(amount)}`
}

function formatGameDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${pad(date.getUTCDate())} ${date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase()} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} ACD`
}

function formatRealTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (days > 0) return `${days}D ${pad(hours)}H ${pad(minutes)}M`
  return `${pad(hours)}H ${pad(minutes)}M ${pad(seconds)}S`
}

async function gmRequest(path, { key, method = 'GET', body } = {}) {
  const headers = { 'x-gm-key': key }
  if (body) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const requestError = new Error(payload?.message || payload?.error || `HTTP ${response.status}`)
    requestError.status = response.status
    requestError.code = payload?.error
    throw requestError
  }
  return payload
}

function PanelHead({ title, right }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-3 py-2 border-b border-carbon-border">
      <h2 className="font-headline text-[11px] font-bold uppercase tracking-widest text-neutral-200 truncate">
        {title}
      </h2>
      <span className="text-[9px] text-neutral-400 whitespace-nowrap">{right}</span>
    </div>
  )
}

function StatCell({ label, value, warning = false }) {
  return (
    <div className="bg-carbon-surface px-3 py-2.5">
      <div className="text-[9px] uppercase tracking-widest text-neutral-400">{label}</div>
      <div className={`mt-1 text-sm font-bold tabular-nums ${warning ? 'text-flight-amber' : 'text-neutral-100'}`}>
        {value}
      </div>
    </div>
  )
}

export default function GmPanel() {
  const [key, setKey] = useState(() => sessionStorage.getItem(KEY_STORAGE) || '')
  const [draftKey, setDraftKey] = useState('')
  const [editingKey, setEditingKey] = useState(() => !sessionStorage.getItem(KEY_STORAGE))
  const [agencies, setAgencies] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [agencyState, setAgencyState] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [scope, setScope] = useState('operations')
  const [customDays, setCustomDays] = useState('')
  const [flushArmed, setFlushArmed] = useState(false)
  const [nowTick, setNowTick] = useState(Date.now())

  const describeError = (err) => {
    if (err?.code === 'GM_DISABLED') {
      return 'GM_ACCESS_KEY belum diset di backend/.env. Tambahkan key lalu restart backend.'
    }
    if (err?.code === 'GM_UNAUTHORIZED' || err?.status === 401) {
      return 'GM key tidak valid. Periksa nilai GM_ACCESS_KEY di backend/.env.'
    }
    return err?.message || 'Request GM gagal'
  }

  const loadAgencies = useCallback(async (accessKey) => {
    if (!accessKey) return
    setLoading(true)
    try {
      const payload = await gmRequest('/gm/agencies', { key: accessKey })
      const list = payload.agencies || []
      setAgencies(list)
      setError('')
      setSelectedId((prev) => (
        list.some((agency) => agency.id === prev) ? prev : (list[0]?.id || '')
      ))
    } catch (err) {
      setAgencies([])
      setAgencyState(null)
      setError(describeError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadState = useCallback(async (accessKey, agencyId) => {
    if (!accessKey || !agencyId) return
    try {
      const payload = await gmRequest(
        `/gm/state?agencyId=${encodeURIComponent(agencyId)}`,
        { key: accessKey },
      )
      setAgencyState(payload)
      setError('')
    } catch (err) {
      setError(describeError(err))
    }
  }, [])

  useEffect(() => {
    if (key) loadAgencies(key)
  }, [key, loadAgencies])

  useEffect(() => {
    if (!key || !selectedId) return undefined
    loadState(key, selectedId)
    const timer = setInterval(() => loadState(key, selectedId), 5000)
    return () => clearInterval(timer)
  }, [key, selectedId, loadState])

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(''), 8000)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!flushArmed) return undefined
    const timer = setTimeout(() => setFlushArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [flushArmed])

  const submitKey = (event) => {
    event.preventDefault()
    const nextKey = draftKey.trim()
    if (!nextKey) return
    sessionStorage.setItem(KEY_STORAGE, nextKey)
    setKey(nextKey)
    setDraftKey('')
    setEditingKey(false)
    setError('')
    setNotice('')
    setAgencyState(null)
  }

  const forgetKey = () => {
    sessionStorage.removeItem(KEY_STORAGE)
    setKey('')
    setDraftKey('')
    setEditingKey(true)
    setAgencies([])
    setSelectedId('')
    setAgencyState(null)
    setError('')
    setNotice('')
  }

  const runAdvance = async ({ gameDays = null, mode = 'shift' } = {}) => {
    if (!key || !selectedId || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const body = { agencyId: selectedId, mode, scope }
      if (mode === 'shift') body.gameDays = gameDays
      const result = await gmRequest('/gm/advance', { key, method: 'POST', body })
      const count = result.updated || 0
      if (count === 0) {
        setNotice('Tidak ada event PENDING dalam scope ini.')
      } else {
        setNotice(
          `${count} event dipercepat. Worker memproses dalam ±5 detik; panel refresh otomatis.`,
        )
      }
      await loadState(key, selectedId)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  const submitCustom = (event) => {
    event.preventDefault()
    const days = Number(customDays)
    if (!Number.isFinite(days) || days <= 0) {
      setError('Durasi game days harus lebih dari 0.')
      return
    }
    setCustomDays('')
    runAdvance({ gameDays: days, mode: 'shift' })
  }

  const handleFlush = () => {
    if (!flushArmed) {
      setFlushArmed(true)
      return
    }
    setFlushArmed(false)
    runAdvance({ mode: 'now' })
  }

  const agency = agencyState?.agency || null
  const season = agencyState?.season || null
  const timeScale = Number(agencyState?.timeScale) || 52.142857
  const events = agencyState?.events || []
  const operationTypes = new Set(agencyState?.operationEventTypes || [])
  const operationEvents = events.filter((event) => operationTypes.has(event.event_type))
  const diplomacyEvents = events.filter((event) => !operationTypes.has(event.event_type))
  const vehicles = agencyState?.vehicles || []
  const missions = agencyState?.missions || []

  if (!key || editingKey) {
    return (
      <div className="afm-dashboard min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md border border-carbon-border bg-carbon-surface">
          <div className="border-b border-carbon-border bg-carbon-container px-4 py-2 flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-flight-amber">admin_panel_settings</span>
            <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-neutral-100">
              GM Access // Restricted
            </span>
          </div>
          <form onSubmit={submitKey} className="p-4 space-y-3">
            <p className="text-[11px] leading-relaxed text-neutral-400">
              Panel ini untuk playtest: mempercepat produksi, rollout, peluncuran, riset, dan event
              terjadwal lain. Masukkan <b className="text-neutral-200">GM_ACCESS_KEY</b> dari{' '}
              <code className="text-flight-amber">backend/.env</code>.
            </p>
            <label className="block">
              <span className="text-[9px] uppercase tracking-widest text-neutral-400">GM Access Key</span>
              <input
                type="password"
                value={draftKey}
                onChange={(event) => setDraftKey(event.target.value)}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className="mt-1 w-full border border-carbon-border bg-carbon-bg px-2.5 py-2 text-xs text-neutral-100 placeholder:text-neutral-500"
                placeholder="paste key here"
              />
            </label>
            {error && (
              <div className="border border-alert-red/40 bg-alert-red/10 px-2.5 py-2 text-[10px] text-alert-red">
                {error}
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <Link
                to="/dashboard"
                className="text-[10px] uppercase tracking-wider text-neutral-400 hover:text-neutral-100 bezier-fast"
              >
                Kembali
              </Link>
              <div className="flex items-center gap-2">
                {key ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingKey(false)
                      setError('')
                    }}
                    className="border border-carbon-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-neutral-300 hover:text-neutral-100 bezier-fast"
                  >
                    Batal
                  </button>
                ) : null}
                <button
                  type="submit"
                  disabled={!draftKey.trim()}
                  className="bg-flight-amber hover:bg-flight-amber-dim disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-black bezier-fast"
                >
                  Unlock GM
                </button>
              </div>
            </div>
            <p className="text-[9px] text-neutral-500 leading-relaxed">
              Key hanya disimpan di sessionStorage tab ini. Tidak dikirim ke frontend lain dan tidak
              disimpan di localStorage.
            </p>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="afm-dashboard min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 bg-carbon-bg border-b border-carbon-border">
        <div className="max-w-[1400px] mx-auto px-4 py-2 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-flight-amber">admin_panel_settings</span>
            <div>
              <div className="font-headline font-bold text-[11px] tracking-widest uppercase text-neutral-100">
                Arcadia // GM Control
              </div>
              <div className="text-[9px] uppercase tracking-widest text-neutral-400">
                Playtest time acceleration
              </div>
            </div>
          </div>
          <span className="border border-alert-red/40 bg-alert-red/10 px-2 py-1 text-[9px] uppercase tracking-wider text-alert-red">
            Live Supabase writes
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/dashboard"
              className="border border-carbon-border px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-neutral-300 hover:text-neutral-100 bezier-fast"
            >
              Dashboard
            </Link>
            <button
              type="button"
              onClick={() => setEditingKey(true)}
              className="border border-carbon-border px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-neutral-300 hover:text-flight-amber bezier-fast"
            >
              Ganti key
            </button>
            <button
              type="button"
              onClick={forgetKey}
              className="text-neutral-400 hover:text-alert-red px-1 py-1 bezier-fast"
              aria-label="Hapus GM key dari sesi"
            >
              <span className="material-symbols-outlined text-sm">logout</span>
            </button>
          </div>
        </div>
      </header>

      <main className="w-full max-w-[1400px] mx-auto px-4 py-4 flex-1 space-y-4">
        {error && (
          <div className="border border-alert-red/40 bg-alert-red/10 px-3 py-2 text-[10px] uppercase tracking-wider text-alert-red">
            {error}
          </div>
        )}
        {notice && (
          <div className="border border-telemetry-green/40 bg-telemetry-green/10 px-3 py-2 text-[10px] uppercase tracking-wider text-telemetry-green">
            {notice}
          </div>
        )}

        <section className="border border-carbon-border bg-carbon-surface">
          <div className="flex flex-wrap items-end gap-3 px-3 py-2.5 border-b border-carbon-border">
            <label className="min-w-[220px] flex-1">
              <span className="text-[9px] uppercase tracking-widest text-neutral-400">Agency</span>
              <select
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
                className="mt-1 w-full border border-carbon-border bg-carbon-bg px-2 py-1.5 text-xs text-neutral-100"
              >
                {agencies.length === 0 ? <option value="">Tidak ada agency</option> : null}
                {agencies.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} // {item.alignment || '—'}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-[10px] text-neutral-400">
              <div>ACD: <span className="text-neutral-100 tabular-nums">{formatGameDate(agencyState?.gameDate)}</span></div>
              <div>Real: <span className="tabular-nums">{formatRealTime(agencyState?.realNow || new Date().toISOString())}</span></div>
            </div>
            <div className="text-[10px] text-neutral-400">
              <div>Season: <span className="text-neutral-100">{season?.name || '—'}</span></div>
              <div>Scale: <span className="text-flight-amber tabular-nums">{timeScale.toFixed(2)} game days / real day</span></div>
            </div>
            <button
              type="button"
              onClick={() => {
                if (key) {
                  loadAgencies(key)
                  if (selectedId) loadState(key, selectedId)
                }
              }}
              className="ml-auto border border-carbon-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-neutral-300 hover:text-flight-amber hover:border-flight-amber/50 bezier-fast flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-sm">refresh</span>
              Refresh
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-carbon-border">
            <StatCell label="Science" value={agency ? `${Number(agency.science_points) || 0} SP` : '—'} />
            <StatCell label="Funding" value={agency ? formatUsd(agency.funding_usd) : '—'} />
            <StatCell label="RP" value={agency ? Number(agency.rp) || 0 : '—'} />
            <StatCell label="Launches" value={agency ? `${Number(agency.total_launches) || 0} / ${Number(agency.successful_launches) || 0} OK` : '—'} />
            <StatCell label="Pending events" value={`${events.length}`} warning={events.length > 0} />
            <StatCell label="Vehicles" value={`${vehicles.length}`} />
          </div>
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <section className="xl:col-span-5 border border-carbon-border bg-carbon-surface">
            <PanelHead
              title="Time Acceleration"
              right={loading ? 'SYNCING' : busy ? 'WRITING' : 'READY'}
            />
            <div className="p-3 space-y-3">
              <div>
                <div className="text-[9px] uppercase tracking-widest text-neutral-400 mb-1.5">Scope</div>
                <div className="grid grid-cols-2 gap-px bg-carbon-border border border-carbon-border">
                  <button
                    type="button"
                    onClick={() => setScope('operations')}
                    className={`px-2 py-1.5 text-[10px] uppercase tracking-wider bezier-fast ${
                      scope === 'operations'
                        ? 'bg-flight-amber/15 text-flight-amber font-bold'
                        : 'bg-carbon-surface text-neutral-400 hover:text-neutral-100'
                    }`}
                  >
                    Operasi
                  </button>
                  <button
                    type="button"
                    onClick={() => setScope('all')}
                    className={`px-2 py-1.5 text-[10px] uppercase tracking-wider bezier-fast ${
                      scope === 'all'
                        ? 'bg-alert-red/15 text-alert-red font-bold'
                        : 'bg-carbon-surface text-neutral-400 hover:text-neutral-100'
                    }`}
                  >
                    Semua event
                  </button>
                </div>
                <p className="mt-1.5 text-[9px] leading-relaxed text-neutral-400">
                  {scope === 'operations'
                    ? 'Produksi, rollout, peluncuran, operasi orbit, riset, dan static fire.'
                    : 'Termasuk proposal dan agreement diplomasi milik agency ini.'}
                </p>
              </div>

              <div>
                <div className="text-[9px] uppercase tracking-widest text-neutral-400 mb-1.5">
                  Percepat operasi (game days)
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                  {PRESETS.map((days) => (
                    <button
                      key={days}
                      type="button"
                      disabled={busy || !selectedId}
                      onClick={() => runAdvance({ gameDays: days, mode: 'shift' })}
                      className="border border-carbon-border px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-neutral-200 hover:border-flight-amber/50 hover:text-flight-amber disabled:opacity-40 disabled:cursor-not-allowed bezier-fast flex flex-col items-center gap-0.5"
                    >
                      <span className="material-symbols-outlined text-sm">fast_forward</span>
                      +{days}D
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[9px] text-neutral-400">
                  Event yang jatuh tempo di masa lalu dijadwalkan berurutan 1 detik agar tidak
                  bertabrakan. Queue worker memproses tiap ±5 detik.
                </p>
              </div>

              <form onSubmit={submitCustom} className="flex items-end gap-2">
                <label className="flex-1">
                  <span className="text-[9px] uppercase tracking-widest text-neutral-400">Custom game days</span>
                  <input
                    type="number"
                    min="0.1"
                    step="1"
                    value={customDays}
                    onChange={(event) => setCustomDays(event.target.value)}
                    placeholder="cth. 45"
                    className="mt-1 w-full border border-carbon-border bg-carbon-bg px-2 py-1.5 text-xs text-neutral-100 placeholder:text-neutral-500"
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy || !selectedId || !customDays}
                  className="bg-flight-amber hover:bg-flight-amber-dim disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-black bezier-fast"
                >
                  Majukan
                </button>
              </form>

              <div className="border-t border-carbon-border pt-3">
                <button
                  type="button"
                  disabled={busy || !selectedId}
                  onClick={handleFlush}
                  className={`w-full border px-3 py-2 text-[10px] font-bold uppercase tracking-wider bezier-fast flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed ${
                    flushArmed
                      ? 'border-alert-red bg-alert-red/20 text-alert-red'
                      : 'border-alert-red/50 text-alert-red hover:bg-alert-red/10'
                  }`}
                >
                  <span className="material-symbols-outlined text-sm">bolt</span>
                  {flushArmed ? 'Klik lagi untuk konfirmasi' : 'Selesaikan semua sekarang'}
                </button>
                <p className="mt-1.5 text-[9px] leading-relaxed text-neutral-400">
                  Semua event PENDING dalam scope dipaksa jatuh tempo sekarang. Untuk scope
                  “Semua event”, event diplomasi agency ini juga ikut diproses.
                </p>
              </div>

              <div className="border border-flight-amber/30 bg-flight-amber/5 px-2.5 py-2 text-[9px] leading-relaxed text-neutral-400">
                Aksi menulis langsung ke tabel <code className="text-flight-amber">scheduled_events</code>{' '}
                pada Supabase live. Efeknya terlihat setelah worker memproses event.
              </div>
            </div>
          </section>

          <section className="xl:col-span-7 border border-carbon-border bg-carbon-surface flex flex-col">
            <PanelHead
              title="Pending Scheduled Events"
              right={`${operationEvents.length} OPS // ${diplomacyEvents.length} DIP`}
            />
            <div className="flex-1 max-h-[520px] overflow-y-auto custom-scroll divide-y divide-carbon-border">
              {events.length === 0 ? (
                <div className="px-3 py-8 text-center text-[10px] uppercase tracking-wider text-neutral-400">
                  // Tidak ada event PENDING
                </div>
              ) : (
                events.map((event) => {
                  const remainingMs = new Date(event.execute_at).getTime() - nowTick
                  const due = remainingMs <= 0
                  const gameDaysLeft = (remainingMs / DAY_MS) * timeScale
                  const isOperation = operationTypes.has(event.event_type)
                  return (
                    <div key={event.id} className="px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-neutral-100">
                          <span className={`material-symbols-outlined text-sm ${isOperation ? 'text-flight-amber' : 'text-neutral-400'}`}>
                            {isOperation ? 'event' : 'handshake'}
                          </span>
                          {EVENT_LABELS[event.event_type] || event.event_type}
                        </span>
                        <span className={`text-[9px] uppercase tracking-wider ${due ? 'text-telemetry-green' : 'text-neutral-400'}`}>
                          {due ? 'DUE // QUEUED' : `${formatDuration(remainingMs)} real`}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[9px] text-neutral-400">
                        <span>ID {String(event.id).slice(0, 8)}</span>
                        <span>TYPE {event.event_type}</span>
                        {!due && (
                          <span>
                            ≈ {gameDaysLeft.toFixed(1)} hari game
                          </span>
                        )}
                        <span>AT {formatRealTime(event.execute_at)}</span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="border border-carbon-border bg-carbon-surface">
            <PanelHead title="Vehicles" right={`${vehicles.length}`} />
            <div className="divide-y divide-carbon-border max-h-[240px] overflow-y-auto custom-scroll">
              {vehicles.length === 0 ? (
                <div className="px-3 py-6 text-center text-[10px] uppercase text-neutral-400">// Kosong</div>
              ) : (
                vehicles.map((vehicle) => (
                  <div key={vehicle.id} className="px-3 py-2 flex items-center justify-between gap-3 text-[10px]">
                    <span className="text-neutral-100 truncate">{toUpper(vehicle.name)}</span>
                    <span className="text-neutral-400 uppercase whitespace-nowrap">{vehicle.status}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="border border-carbon-border bg-carbon-surface">
            <PanelHead title="Missions" right={`${missions.length}`} />
            <div className="divide-y divide-carbon-border max-h-[240px] overflow-y-auto custom-scroll">
              {missions.length === 0 ? (
                <div className="px-3 py-6 text-center text-[10px] uppercase text-neutral-400">// Kosong</div>
              ) : (
                missions.map((mission) => (
                  <div key={mission.id} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-3 text-[10px]">
                      <span className="text-neutral-100 truncate">{toUpper(mission.name)}</span>
                      <span className="text-flight-amber uppercase whitespace-nowrap">{mission.status}</span>
                    </div>
                    <div className="text-[9px] text-neutral-400 mt-0.5">
                      Launch {formatRealTime(mission.scheduled_launch_at)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
