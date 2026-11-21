import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './Dashboard.css'
import launchPad from '../assets/launch-pad.jpg'
import Engineering from './Engineering'
import Tracking from './Tracking'
import Relations from './Relations'
import Calendar from './Calendar'
import Economy from './Economy'
import LaunchGlobe from '../components/LaunchGlobe'
import OnboardingPanel from '../components/OnboardingPanel'
import TutorialPanel from '../components/TutorialPanel'
import { clearSession, getAccessToken } from '../lib/session'

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8787/api').replace(/\/$/, '')
const CYCLE = '14'
const MAX_BUFFER = 200

const VEHICLE_TYPES = ['sounding-rocket', 'orbital-rocket', 'satellite', 'capsule', 'probe', 'lander']
const MISSION_TYPES = ['test', 'scientific', 'manned', 'colonial']

const VEHICLE_LABEL = {
  'sounding-rocket': 'ROKET SONDA',
  'orbital-rocket': 'ROKET ORBITAL',
  satellite: 'SATELIT',
  capsule: 'KAPSUL',
  probe: 'PROBE',
  lander: 'LANDER',
}

const MISSION_LABEL = {
  test: 'UJI TEKNIS',
  scientific: 'SAINTIFIK',
  manned: 'BERAWAK',
  colonial: 'KOLONIAL',
}

const TONE_CLASS = {
  system: 'text-neutral-400',
  prompt: 'text-neutral-400',
  info: 'text-neutral-300',
  ok: 'text-neutral-100',
  warn: 'text-flight-amber',
  error: 'text-alert-red',
  data: 'text-neutral-400',
}

const BOOT_LINES = [
  { id: 1, tone: 'system', text: '// AFM-OS REV 3.4.1 (1969.OCT) - CORE LOADED' },
  { id: 2, tone: 'warn', text: '> CHECKLIST: CRYOGENIC HELIUM PURGE VERIFIED' },
  { id: 3, tone: 'data', text: '> LINK ESTABLISHED: CAPE MERIDIAN MCC // DSN-14' },
  { id: 4, tone: 'info', text: '> TYPE /bantuan FOR DIRECTIVE INDEX' },
]

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
const clamp = (value) => Math.max(0, Math.min(100, num(value)))
const pad = (value) => String(value).padStart(2, '0')
const toUpper = (value) => String(value ?? '').toUpperCase()

function titleCase(value) {
  return String(value ?? '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function vehicleStateLabel(vehicle) {
  if (vehicle.status === 'manufacturing') return 'PRODUCTION'
  if (vehicle.status === 'assigned') return 'ASSIGNED'
  return VEHICLE_LABEL[vehicle.type] || titleCase(vehicle.type)
}

function formatUsd(value) {
  const amount = num(value)
  if (amount >= 1000000000) return `$${(amount / 1000000000).toFixed(2)}B`
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`
  if (amount >= 1000) return `$${Math.round(amount / 1000)}K`
  return `$${Math.round(amount)}`
}

function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.floor(num(totalSeconds)))
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`
}

function formatTime(value) {
  if (!value) return '--:--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--'
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`
}

function stabilityState(si) {
  if (si >= 70) return { label: 'NOMINAL', tone: 'text-neutral-300' }
  if (si >= 30) return { label: 'WASPADA', tone: 'text-flight-amber' }
  return { label: 'KRISIS', tone: 'text-alert-red' }
}

function fundingState(fundingUsd) {
  if (fundingUsd >= 50000000) return { label: 'KUAT', tone: 'text-neutral-300' }
  if (fundingUsd >= 10000000) return { label: 'CUKUP', tone: 'text-flight-amber' }
  return { label: 'TIPIS', tone: 'text-alert-red' }
}

function eventTone(type) {
  const value = toUpper(type)
  if (value.includes('FAIL') || value.includes('CRASH')) return 'text-alert-red'
  return 'text-neutral-200'
}

async function apiRequest(path, options = {}) {
  const token = await getAccessToken()
  const headers = { ...(options.headers || {}) }
  if (options.body) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers })
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (response.status === 401) {
    clearSession()
    if (window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
  }

  if (!response.ok) {
    const requestError = new Error(payload?.message || payload?.error || `HTTP ${response.status}`)
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
      <span className="text-[10px] text-neutral-400 whitespace-nowrap">{right}</span>
    </div>
  )
}

function ConsoleLine({ line }) {
  return (
    <div className={`text-[11px] leading-relaxed whitespace-pre-wrap break-words ${TONE_CLASS[line.tone] || TONE_CLASS.info}`}>
      {line.text}
    </div>
  )
}

function InfoRow({ label, value, tone = 'text-neutral-100' }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] uppercase tracking-wide text-neutral-400">{label}</span>
      <span className={`text-right truncate ${tone}`}>{value}</span>
    </div>
  )
}

export default function Dashboard({ user }) {
  const navigate = useNavigate()
  const [agency, setAgency] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [clock, setClock] = useState(4 * 3600 + 12 * 60)
  const [countdown, setCountdown] = useState(14 * 60 + 22)
  const [command, setCommand] = useState('')
  const [commandBusy, setCommandBusy] = useState(false)
  const [consoleLines, setConsoleLines] = useState(BOOT_LINES)
  const [notice, setNotice] = useState('')
  const [nowTick, setNowTick] = useState(Date.now())
  const [view, setView] = useState('flight')
  const [engineeringTab, setEngineeringTab] = useState('tech')
  const [orbitOverview, setOrbitOverview] = useState(null)
  const [orbitLoading, setOrbitLoading] = useState(false)
  const [orbitError, setOrbitError] = useState('')
  const [tutorialOpen, setTutorialOpen] = useState(false)

  const agencyId = dashboard?.agency?.id || agency?.id
  const lineSequence = useRef(BOOT_LINES.length + 1)
  const consoleRef = useRef(null)
  const inputRef = useRef(null)

  const pushLine = useCallback((tone, text) => {
    const id = lineSequence.current
    lineSequence.current += 1
    setConsoleLines((prev) => {
      const next = [...prev, { id, tone, text }]
      return next.length > MAX_BUFFER ? next.slice(next.length - MAX_BUFFER) : next
    })
  }, [])

  const loadDashboard = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true)
      setError('')
      try {
        const agencyData = await apiRequest(`/agency/${user.id}`)
        const dashboardData = await apiRequest(`/dashboard/${agencyData.id}`)
        setAgency(agencyData)
        setDashboard(dashboardData)
        localStorage.setItem('afm_agency', JSON.stringify(agencyData))
      } catch (err) {
        if (silent) {
          pushLine('error', `> REFRESH FAILED: ${toUpper(err.message || 'UNKNOWN')}`)
        } else {
          setError(err.message || 'Handshake dengan MCC gagal')
        }
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [pushLine, user.id],
  )

  useEffect(() => {
    if (user?.id) loadDashboard()
  }, [loadDashboard, user])

  const loadOrbit = useCallback(
    async ({ silent = true } = {}) => {
      if (!agencyId) return
      if (!silent) setOrbitLoading(true)
      try {
        const data = await apiRequest(`/orbit/overview/${agencyId}`)
        setOrbitOverview(data)
        setOrbitError('')
      } catch (err) {
        setOrbitError(err.message || 'Orbit feed unavailable')
      } finally {
        if (!silent) setOrbitLoading(false)
      }
    },
    [agencyId],
  )

  useEffect(() => {
    if (!user?.id) return undefined
    const timer = setInterval(() => loadDashboard({ silent: true }), 30000)
    return () => clearInterval(timer)
  }, [loadDashboard, user?.id])

  useEffect(() => {
    if (!agencyId) return undefined
    loadOrbit()
    const timer = setInterval(() => loadOrbit(), 20000)
    return () => clearInterval(timer)
  }, [agencyId, loadOrbit])

  useEffect(() => {
    const timer = setInterval(() => {
      setClock((prev) => prev + 1)
      setNowTick(Date.now())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 14 * 60 + 22))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const node = consoleRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [consoleLines])

  const agencyView = dashboard?.agency || agency || {}
  const logs = dashboard?.logs || []
  const vehicles = useMemo(
    () =>
      [...(dashboard?.vehicles || [])].sort(
        (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
      ),
    [dashboard],
  )

  const primaryVehicle =
    vehicles.find((vehicle) => !['manufacturing', 'assigned'].includes(vehicle.status)) || null
  const activeMission =
    (dashboard?.missions || []).find((mission) =>
      ['PLANNED', 'ROLLOUT', 'COUNTDOWN', 'ASCENT', 'ORBIT'].includes(mission.status),
    ) || null
  const missionCountdownSeconds = activeMission?.scheduled_launch_at
    ? Math.max(0, Math.floor((new Date(activeMission.scheduled_launch_at).getTime() - nowTick) / 1000))
    : null
  const displayVehicle =
    vehicles.find((vehicle) => vehicle.id === activeMission?.vehicle_id) || primaryVehicle
  const agencyRank = num(dashboard?.agencyRank)
  const agencyName = agencyView.name || 'AGENSI TANPA NAMA'
  const country = agencyView.country || 'TIDAK DIKETAHUI'
  const needsOnboarding = Boolean(agencyView.id)
    && (!agencyView.profile_complete || !agencyView.launch_site_name)

  const sciencePoints = num(agencyView.science_points)
  const fundingUsd = num(agencyView.funding_usd)
  const rp = num(agencyView.rp)
  const si = num(agencyView.si)
  const slr = num(agencyView.slr)
  const totalLaunches = num(agencyView.total_launches)

  const siState = stabilityState(si)
  const fundingFlag = fundingState(fundingUsd)
  const reliability = displayVehicle ? Math.round(num(displayVehicle.reliability)) : null

  const generateName = (prefix) => `${prefix}-${String(Date.now()).slice(-5)}`
  const trackedMission =
    orbitOverview?.missions?.find((mission) => mission.id === activeMission?.id)
    || orbitOverview?.missions?.[0]
    || null

  const runCommand = useCallback(
    async (raw) => {
      const input = String(raw || '').trim()
      if (!input) return

      pushLine('prompt', `VALORIA@MCC-1969:~$ ${input}`)
      const [head, ...rest] = input.split(/\s+/)
      const directive = head.toLowerCase()
      const args = rest.filter(Boolean)

      if (directive === '/bersih' || directive === '/clear') {
        setConsoleLines([])
        return
      }

      if (directive === '/bantuan' || directive === '/help') {
        pushLine('info', '> DIRECTIVE INDEX:')
        pushLine('data', '  /riset <teknologi>              - mulai riset teknologi')
        pushLine('data', '  /produksi <tipe> [nama]         - rakit vehicle baru')
        pushLine('data', `     tipe: ${VEHICLE_TYPES.join(' | ')}`)
        pushLine('data', '  /luncurkan <tipe> [nama]        - jalankan misi')
        pushLine('data', `     tipe: ${MISSION_TYPES.join(' | ')}`)
        pushLine('data', '  /uji [nama]                     - misi uji teknis cepat')
        pushLine('data', '  /lacak                          - buka orbital tracking')
        pushLine('data', '  /bersih                         - kosongkan buffer')
        return
      }

      if (directive === '/lacak' || directive === '/tracking') {
        setView('tracking')
        pushLine('info', '> ORBITAL TRACKING DISPLAY ACTIVE')
        return
      }

      if (commandBusy) {
        pushLine('warn', '> DIRECTIVE QUEUE BUSY // TUNGGU EKSEKUSI SEBELUMNYA')
        return
      }

      if (!agencyId) {
        pushLine('error', '> ERROR: AGENSI BELUM TERHUBUNG KE MCC')
        return
      }

      setCommandBusy(true)
      try {
        if (directive === '/riset' || directive === '/research') {
          const technology = args.join(' ').trim()
          if (!technology) throw new Error('SYNTAX: /riset <nama-teknologi>')
          pushLine('info', `> REQUEST RESEARCH: ${toUpper(technology)}`)
          const result = await apiRequest('/research/start', {
            method: 'POST',
            body: JSON.stringify({ agencyId, technologyName: technology }),
          })
          pushLine('ok', `> RESEARCH STARTED: ${toUpper(result.technology)} // ${result.durationGameDays} HARI GAME`)
          pushLine(
            'data',
            `> BIAYA ${result.cost?.science_points} SP / ${formatUsd(result.cost?.funding_usd)} // SALDO ${result.newStats?.science_points} SP / ${formatUsd(result.newStats?.funding_usd)}`,
          )
          await Promise.all([loadDashboard({ silent: true }), loadOrbit()])
        } else if (directive === '/produksi' || directive === '/produce') {
          const type = (args[0] || '').toLowerCase()
          if (!VEHICLE_TYPES.includes(type)) {
            throw new Error(`SYNTAX: /produksi <${VEHICLE_TYPES.join('|')}> [nama]`)
          }
          const name = args.slice(1).join(' ').trim() || generateName(toUpper(type.split('-')[0]))
          pushLine('info', `> ASSEMBLY ORDER: ${toUpper(name)} [${type}]`)
          const result = await apiRequest('/production/vehicle', {
            method: 'POST',
            body: JSON.stringify({ agencyId, vehicleName: name, vehicleType: type }),
          })
          pushLine('ok', `> ASSEMBLY STARTED: ${toUpper(result.vehicle.name)} // ${result.productionGameDays} HARI GAME`)
          pushLine(
            'data',
            `> READY ${formatTime(result.productionCompletesAt)} // SALDO ${formatUsd(result.newStats?.funding_usd)}`,
          )
          await loadDashboard({ silent: true })
        } else if (['/luncurkan', '/launch', '/uji', '/test'].includes(directive)) {
          const isQuickTest = directive === '/uji' || directive === '/test'
          const type = isQuickTest ? 'test' : (args[0] || '').toLowerCase()
          const nameArgs = isQuickTest ? args : args.slice(1)

          if (!isQuickTest && !MISSION_TYPES.includes(type)) {
            throw new Error(`SYNTAX: /luncurkan <${MISSION_TYPES.join('|')}> [nama]`)
          }
          if (!primaryVehicle) {
            throw new Error('TIDAK ADA VEHICLE SIAP DI HANGAR BAY // /produksi DULU')
          }

          const missionName = nameArgs.join(' ').trim() || generateName(`MISI-${toUpper(type)}`)
          pushLine('info', `> LAUNCH DIRECTIVE: ${toUpper(missionName)} // ${MISSION_LABEL[type] || titleCase(type)}`)

          const result = await apiRequest('/launch/mission', {
            method: 'POST',
            body: JSON.stringify({
              agencyId,
              missionName,
              vehicleId: primaryVehicle.id,
              missionType: type,
            }),
          })
          pushLine('ok', `> LAUNCH WINDOW LOCKED: ${toUpper(missionName)}`)
          pushLine(
            'data',
            `> ROLLOUT COMPLETE ${formatTime(result.rolloutCompletesAt)} // IGNITION ${formatTime(result.scheduledLaunchAt)}`,
          )
          pushLine(
            'data',
            `> SALDO ${formatUsd(result.newStats?.funding_usd)} // SP ${result.newStats?.science_points} // RP ${result.newStats?.rp}`,
          )
          await Promise.all([loadDashboard({ silent: true }), loadOrbit()])
        } else {
          throw new Error(`DIRECTIVE TIDAK DIKENAL: ${directive} // GUNAKAN /bantuan`)
        }
      } catch (err) {
        pushLine('error', `> ERROR: ${toUpper(err.message || 'EXECUTION FAILED')}`)
      } finally {
        setCommandBusy(false)
      }
    },
    [agencyId, commandBusy, loadDashboard, loadOrbit, primaryVehicle, pushLine],
  )

  const handleCommandSubmit = (event) => {
    event.preventDefault()
    if (commandBusy) return
    const value = command
    setCommand('')
    runCommand(value)
  }

  const handleLaunch = () => {
    if (commandBusy) return
    if (activeMission) {
      setNotice(`MISSION ACTIVE: ${toUpper(activeMission.name)} // ${activeMission.status}`)
      return
    }
    if (!primaryVehicle) {
      const assembly = vehicles.find((vehicle) => vehicle.status === 'manufacturing')
      if (assembly) {
        setNotice(`ASSEMBLY IN PROGRESS: ${toUpper(assembly.name)}`)
        return
      }
      setCommand('/produksi orbital-rocket ')
      requestAnimationFrame(() => inputRef.current?.focus())
      return
    }
    runCommand(`/luncurkan test ${generateName('MISI-UJI')}`)
  }

  const openFlight = () => {
    setView('flight')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openEngineering = (tab) => {
    setView('engineering')
    setEngineeringTab(tab)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleTutorialNavigate = (targetView, tab) => {
    if (targetView === 'engineering') {
      openEngineering(tab || 'tech')
      return
    }
    if (targetView === 'tracking') {
      openTracking()
      return
    }
    if (targetView === 'relations') {
      openRelations()
      return
    }
    openFlight()
  }

  const handleProfileSaved = useCallback(
    (updatedAgency) => {
      if (!updatedAgency) return
      setAgency(updatedAgency)
      setDashboard((prev) => (
        prev ? { ...prev, agency: { ...prev.agency, ...updatedAgency } } : prev
      ))
      pushLine('ok', '> AGENCY PROFILE LOCKED // ALIGNMENT + LAUNCH SITE CONFIGURED')
    },
    [pushLine],
  )

  const openTracking = () => {
    setView('tracking')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openRelations = () => {
    setView('relations')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openCalendar = () => {
    setView('calendar')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openEconomy = () => {
    setView('economy')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleLogout = () => {
    clearSession()
    navigate('/login')
  }

  if (loading) {
    return (
      <div className="afm-dashboard min-h-screen flex items-center justify-center px-4">
        <div className="border border-carbon-border bg-carbon-surface px-4 py-3 text-[11px] text-neutral-300 uppercase tracking-widest">
          // MENGHUBUNGKAN MCC<span className="afm-cursor ml-2" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="afm-dashboard min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md border border-carbon-border bg-carbon-surface">
          <div className="border-b border-alert-red/40 px-4 py-2 text-[10px] uppercase tracking-widest text-alert-red">
            Connection lost
          </div>
          <div className="px-4 py-3 space-y-3">
            <p className="text-[11px] text-alert-red">&gt; {toUpper(error)}</p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleLogout}
                className="border border-carbon-border text-neutral-300 hover:text-neutral-100 hover:border-carbon-border-light px-3 py-1.5 text-[10px] uppercase tracking-wider bezier-fast"
              >
                Logout
              </button>
              <button
                type="button"
                onClick={() => loadDashboard()}
                className="bg-flight-amber hover:bg-flight-amber-dim text-black px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bezier-fast"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const navButton = (active, onClick, icon, label) => (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-1.5 px-3 py-2 text-[10px] uppercase tracking-wider border-b-2 whitespace-nowrap bezier-fast ${
        active
          ? 'border-flight-amber text-flight-amber font-bold'
          : 'border-transparent text-neutral-400 hover:text-neutral-100'
      }`}
    >
      {icon ? <span className="material-symbols-outlined text-sm">{icon}</span> : null}
      {label}
    </button>
  )

  return (
    <div className="afm-dashboard min-h-screen flex flex-col text-neutral-300 font-mono antialiased">
      <header className="sticky top-0 z-50 bg-carbon-bg border-b border-carbon-border">
        <div className="px-4 flex items-center gap-3">
          <div className="flex items-center gap-2 min-w-0 py-2">
            <span className="text-flight-amber flex items-center gap-1.5 shrink-0" aria-hidden="true">
              <span className="material-symbols-outlined text-base">satellite_alt</span>
            </span>
            <div className="shrink-0">
              <div className="font-headline font-bold text-[11px] tracking-widest uppercase text-neutral-100">
                ARCADIA
              </div>
              <div className="hidden sm:block text-[9px] uppercase tracking-widest text-neutral-400 truncate">
                {toUpper(country)} // Cycle {CYCLE}
              </div>
            </div>
            <div className="hidden md:block min-w-0 border-l border-carbon-border pl-3 ml-1">
              <div className="text-xs font-semibold text-neutral-100 truncate">{toUpper(agencyName)}</div>
            </div>
          </div>

          <nav className="flex items-center gap-0.5 overflow-x-auto custom-scroll ml-auto self-stretch">
            {navButton(view === 'flight', openFlight, 'rocket_launch', 'Flight')}
            {navButton(view === 'tracking', openTracking, 'satellite_alt', 'Tracking')}
            {navButton(view === 'economy', openEconomy, 'payments', 'Contracts')}
            {navButton(view === 'calendar', openCalendar, 'calendar_month', 'Calendar')}
            {navButton(view === 'relations', openRelations, null, 'Relations')}
            {navButton(
              view === 'engineering' && engineeringTab !== 'hangar',
              () => openEngineering('tech'),
              'science',
              'R&D',
            )}
            {navButton(
              view === 'engineering' && engineeringTab === 'hangar',
              () => openEngineering('hangar'),
              'precision_manufacturing',
              'Hangar',
            )}
            {navButton(tutorialOpen, () => setTutorialOpen(true), 'school', 'Tutorial')}
          </nav>

          <button
            type="button"
            onClick={handleLogout}
            aria-label="Logout"
            className="text-neutral-400 hover:text-neutral-100 px-1 py-1 bezier-fast shrink-0"
          >
            <span className="material-symbols-outlined text-sm">logout</span>
          </button>
        </div>

        <div className="px-4 py-1.5 border-t border-carbon-border flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px] uppercase tracking-wider text-neutral-400">
          <span>
            SP <b className="text-neutral-100 text-xs tabular-nums">{sciencePoints}</b>
          </span>
          <span>
            FUNDING <b className="text-neutral-100 text-xs tabular-nums">{formatUsd(fundingUsd)}</b>{' '}
            <span className={fundingFlag.tone}>[{fundingFlag.label}]</span>
          </span>
          <span>
            RP <b className="text-neutral-100 text-xs">{rp}</b> <span className="text-neutral-400">#{agencyRank || '—'}</span>
          </span>
          <span>
            SI <b className="text-neutral-100 text-xs">{si}%</b> <span className={siState.tone}>[{siState.label}]</span>
          </span>
          <span className="ml-auto text-neutral-400">T+{formatClock(clock)}</span>
        </div>
      </header>

      <main className="w-full max-w-[1400px] mx-auto px-4 py-4 flex-1">
        {notice && (
          <div className="mb-4 border border-flight-amber/40 bg-flight-amber/10 text-flight-amber px-3 py-2 text-[10px] uppercase tracking-wider">
            {notice}
          </div>
        )}

        {dashboard?.missionsError && (
          <div className="mb-4 border border-alert-red/40 bg-alert-red/10 text-alert-red px-3 py-2 text-[10px] uppercase tracking-wider">
            Mission feed degraded: {dashboard.missionsError}
          </div>
        )}

        {view === 'flight' ? (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-px bg-carbon-border border border-carbon-border">
            <section className="xl:col-span-8 bg-carbon-surface flex flex-col">
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-carbon-border">
                <h2 className="font-headline text-[11px] font-bold uppercase tracking-widest text-neutral-200 truncate">
                  Launch Complex 39-B // {activeMission ? activeMission.status : 'Pad-01'}
                </h2>
                <span className="text-xs text-neutral-300 tracking-widest whitespace-nowrap">
                  {activeMission?.status === 'ORBIT'
                    ? `ORBIT // ${toUpper(activeMission.name)}`
                    : `T - ${formatClock(missionCountdownSeconds ?? countdown)}`}
                </span>
              </div>

              <div className="grid sm:grid-cols-2 flex-1">
                {trackedMission ? (
                  <div className="relative h-44 sm:h-auto min-h-[180px] border-b sm:border-b-0 sm:border-r border-carbon-border bg-carbon-bg">
                    <LaunchGlobe overview={orbitOverview} mission={trackedMission} />
                  </div>
                ) : (
                  <div
                    className="relative h-44 sm:h-auto min-h-[180px] bg-cover bg-center border-b sm:border-b-0 sm:border-r border-carbon-border"
                    style={{ backgroundImage: `url(${launchPad})` }}
                    role="img"
                    aria-label="Launch pad 39-B"
                  />
                )}

                <div className="p-3 flex flex-col justify-between gap-3">
                  <div className="space-y-1.5 text-xs">
                    <InfoRow label="VEHICLE" value={displayVehicle ? toUpper(displayVehicle.name) : 'NONE'} />
                    <InfoRow
                      label="TYPE"
                      value={displayVehicle ? vehicleStateLabel(displayVehicle) : 'STANDBY'}
                    />
                    <InfoRow
                      label="RELIABILITY"
                      value={reliability === null ? '—' : `${reliability}%`}
                      tone={reliability !== null && reliability < 70 ? 'text-flight-amber' : 'text-neutral-100'}
                    />
                    <InfoRow label="SUCCESS RATE" value={`${slr}% (${totalLaunches} LAUNCH)`} />
                  </div>

                  <button
                    type="button"
                    onClick={handleLaunch}
                    disabled={commandBusy || Boolean(activeMission)}
                    className="w-full bg-flight-amber hover:bg-flight-amber-dim disabled:opacity-60 disabled:cursor-not-allowed text-black font-bold text-[11px] uppercase px-3 py-2 flex items-center justify-center gap-1.5 bezier-fast"
                  >
                    <span className="material-symbols-outlined text-sm">rocket_launch</span>
                    {activeMission ? 'Misi Aktif' : primaryVehicle ? 'Autorisasi Luncur' : 'Rakit Wahana Dulu'}
                  </button>
                </div>
              </div>
            </section>

            <aside className="xl:col-span-4 bg-carbon-surface flex flex-col">
              <PanelHead title="Hangar Bay // Vehicles" right={`${vehicles.length} UNIT`} />
              <div className="flex-1 divide-y divide-carbon-border">
                {vehicles.length === 0 ? (
                  <div className="px-3 py-6 text-center text-[10px] text-neutral-400 uppercase">
                    Hangar kosong
                  </div>
                ) : (
                  vehicles.slice(0, 3).map((vehicle) => (
                    <div key={vehicle.id} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-neutral-100 truncate">{toUpper(vehicle.name)}</span>
                        <span className="text-[9px] text-neutral-400 uppercase whitespace-nowrap">
                          {vehicleStateLabel(vehicle)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <div className="flex-1 h-1 bg-carbon-bg">
                          <div
                            className="h-full bg-flight-amber"
                            style={{ width: `${clamp(vehicle.reliability)}%` }}
                          />
                        </div>
                        <span className="text-[9px] text-neutral-300">{Math.round(num(vehicle.reliability))}%</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <button
                type="button"
                onClick={() => openEngineering('hangar')}
                className="m-3 border border-carbon-border text-neutral-300 hover:text-flight-amber hover:border-flight-amber/50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bezier-fast flex items-center justify-center gap-1.5"
              >
                <span className="material-symbols-outlined text-sm">precision_manufacturing</span>
                Buka Hangar
              </button>
            </aside>

            <section className="xl:col-span-8 bg-carbon-surface flex flex-col">
              <PanelHead title="VT-100 Console" right={commandBusy ? 'BUSY' : 'READY'} />
              <div
                ref={consoleRef}
                className="p-3 bg-carbon-bg border-b border-carbon-border text-xs h-[200px] overflow-y-auto custom-scroll flex flex-col"
              >
                <div className="space-y-0.5 mt-auto">
                  {consoleLines.length === 0 && <div className="text-neutral-400">// BUFFER CLEAR</div>}
                  {consoleLines.map((line) => (
                    <ConsoleLine key={line.id} line={line} />
                  ))}
                </div>
              </div>
              <form onSubmit={handleCommandSubmit} className="p-2 flex items-center gap-1.5 text-xs">
                <span className="text-neutral-400 shrink-0 text-[11px]">~$</span>
                <input
                  ref={inputRef}
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="/bantuan"
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="Terminal command"
                  className="flex-1 min-w-0 bg-transparent border-0 text-neutral-100 px-0 py-0 text-xs placeholder:text-neutral-400"
                />
                <button
                  type="submit"
                  disabled={commandBusy}
                  className="border border-carbon-border text-flight-amber hover:border-flight-amber/60 hover:bg-flight-amber/10 disabled:opacity-50 px-2.5 py-1 text-[10px] font-bold uppercase bezier-fast"
                >
                  EXEC
                </button>
              </form>
            </section>

            <section className="xl:col-span-4 bg-carbon-surface flex flex-col">
              <PanelHead title="AGM Event Stream" right={`${logs.length}`} />
              <div className="flex-1 max-h-[240px] overflow-y-auto custom-scroll divide-y divide-carbon-border">
                {logs.length === 0 ? (
                  <div className="px-3 py-6 text-[10px] text-neutral-400 uppercase">// Tidak ada event</div>
                ) : (
                  logs.slice(0, 8).map((log) => (
                    <div key={log.id} className="px-3 py-2 text-[10px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`font-bold ${eventTone(log.event_type)}`}>{toUpper(log.event_type || 'EVENT')}</span>
                        <span className="text-neutral-400">{formatTime(log.created_at)}</span>
                      </div>
                      <p className="text-neutral-400 mt-0.5 leading-snug truncate">{log.description}</p>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        ) : view === 'tracking' ? (
          <Tracking
            overview={orbitOverview}
            loading={orbitLoading}
            error={orbitError}
            onRefresh={() => loadOrbit({ silent: false })}
            agencyName={agencyName}
          />
        ) : view === 'calendar' ? (
          <Calendar apiRequest={apiRequest} />
        ) : view === 'economy' ? (
          <Economy
            agencyId={agencyId}
            agencyName={agencyName}
            apiRequest={apiRequest}
            vehicles={vehicles}
            onRefresh={() => loadDashboard({ silent: true })}
            notify={setNotice}
          />
        ) : view === 'relations' ? (
          <Relations
            agencyId={agencyId}
            agencyName={agencyName}
            apiRequest={apiRequest}
            onChange={() => loadDashboard({ silent: true })}
          />
        ) : (
          <Engineering
            agencyId={agencyId}
            agencyName={agencyName}
            alignment={agencyView.alignment}
            westernStanding={num(agencyView.western_standing)}
            easternStanding={num(agencyView.eastern_standing)}
            sciencePoints={sciencePoints}
            fundingUsd={fundingUsd}
            rp={rp}
            vehicles={vehicles}
            tab={engineeringTab}
            onTabChange={setEngineeringTab}
            onRefresh={async () => {
              await loadDashboard({ silent: true })
              await loadOrbit()
            }}
            pushLine={pushLine}
            notify={setNotice}
            apiRequest={apiRequest}
          />
        )}
      </main>

      {needsOnboarding && (
        <OnboardingPanel
          agency={agencyView}
          apiRequest={apiRequest}
          onSaved={handleProfileSaved}
          onLogout={handleLogout}
        />
      )}

      {!needsOnboarding && (
        <TutorialPanel
          open={tutorialOpen}
          onClose={() => setTutorialOpen(false)}
          agencyId={agencyId}
          onNavigate={handleTutorialNavigate}
        />
      )}
    </div>
  )
}
