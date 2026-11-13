import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './Dashboard.css'
import launchPad from '../assets/launch-pad.jpg'
import Engineering from './Engineering'

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8787/api').replace(/\/$/, '')
const MAX_AP = 50
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
  system: 'text-neutral-500',
  prompt: 'text-telemetry-cyan',
  info: 'text-neutral-300',
  ok: 'text-phosphor-teal',
  warn: 'text-flight-amber',
  error: 'text-alert-red',
  data: 'text-telemetry-cyan',
}

const QUICK_COMMANDS = [
  { label: '/bantuan', prefix: '/bantuan' },
  { label: '/luncurkan test', prefix: '/luncurkan test ' },
  { label: '/riset ', prefix: '/riset ' },
  { label: '/produksi', prefix: '/produksi orbital-rocket ' },
]

const BOOT_LINES = [
  { id: 1, tone: 'system', text: '// AFM-OS REV 3.4.1 (1969.OCT) - CORE LOADED' },
  { id: 2, tone: 'system', text: '// FORMULA REF: floor(rp / 20) + uniform_variance(-5, +5)' },
  { id: 3, tone: 'warn', text: '> CHECKLIST: CRYOGENIC HELIUM PURGE VERIFIED' },
  { id: 4, tone: 'data', text: '> LINK ESTABLISHED: CAPE MERIDIAN MCC // DSN-14' },
  { id: 5, tone: 'info', text: '> TYPE /bantuan FOR DIRECTIVE INDEX' },
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

function signed(value, digits = 0) {
  const n = num(value)
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`
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

function powerTier(ipi, si) {
  const score = (num(ipi) + num(si)) / 2
  if (score >= 85) return 'SUPERIOR'
  if (score >= 70) return 'TINGGI'
  if (score >= 50) return 'MENENGAH'
  if (score >= 30) return 'TERBATAS'
  return 'KRITIS'
}

function stabilityState(si) {
  if (si >= 70) return { label: 'NOMINAL', tone: 'text-phosphor-teal border-phosphor-teal/40' }
  if (si >= 30) return { label: 'WASPADA', tone: 'text-flight-amber border-flight-amber/40' }
  return { label: 'KRISIS', tone: 'text-alert-red border-alert-red/40' }
}

function budgetState(budget) {
  if (budget >= 40) return { label: 'KUAT', tone: 'text-phosphor-teal border-phosphor-teal/40' }
  if (budget >= 15) return { label: 'CUKUP', tone: 'text-flight-amber border-flight-amber/40' }
  return { label: 'TIPIS', tone: 'text-alert-red border-alert-red/40' }
}

function eventTone(type) {
  const value = toUpper(type)
  if (value.includes('FAIL') || value.includes('CRASH')) return 'text-alert-red'
  if (value.includes('COMPLETED') || value.includes('SUCCESS')) return 'text-phosphor-teal'
  if (value.includes('RESEARCH')) return 'text-telemetry-cyan'
  if (value.includes('PRODUCTION')) return 'text-flight-amber'
  return 'text-neutral-300'
}

function getSession() {
  try {
    return JSON.parse(localStorage.getItem('afm_session') || '{}')
  } catch {
    return {}
  }
}

async function apiRequest(path, options = {}) {
  const session = getSession()
  const headers = { ...(options.headers || {}) }
  if (options.body) headers['Content-Type'] = 'application/json'
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers })
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`)
  }
  return payload
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
      <span className="text-[10px] uppercase text-neutral-500">{label}</span>
      <span className={`text-right truncate ${tone}`}>{value}</span>
    </div>
  )
}

function OrbitStat({ label, value, tone = 'text-neutral-200' }) {
  return (
    <div className="border-t border-r border-carbon-border px-3 py-2 even:border-r-0">
      <div className="text-[9px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className={`text-xs font-bold ${tone}`}>{value}</div>
    </div>
  )
}

export default function Dashboard({ user }) {
  const navigate = useNavigate()
  const [agency, setAgency] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [ranking, setRanking] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [clock, setClock] = useState(4 * 3600 + 12 * 60)
  const [countdown, setCountdown] = useState(14 * 60 + 22)
  const [countdownPaused, setCountdownPaused] = useState(false)
  const [command, setCommand] = useState('')
  const [commandBusy, setCommandBusy] = useState(false)
  const [consoleLines, setConsoleLines] = useState(BOOT_LINES)
  const [notice, setNotice] = useState('')
  const [latency, setLatency] = useState(24)
  const [view, setView] = useState('flight')
  const [engineeringTab, setEngineeringTab] = useState('tech')

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
        const [dashboardData, rankingData] = await Promise.all([
          apiRequest(`/dashboard/${agencyData.id}`),
          apiRequest('/dashboard/ranking/global').catch(() => []),
        ])
        setAgency(agencyData)
        setDashboard(dashboardData)
        setRanking(Array.isArray(rankingData) ? rankingData : [])
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

  useEffect(() => {
    const timer = setInterval(() => setClock((prev) => prev + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (countdownPaused) return undefined
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 14 * 60 + 22))
    }, 1000)
    return () => clearInterval(timer)
  }, [countdownPaused])

  useEffect(() => {
    const timer = setInterval(() => setLatency(18 + Math.random() * 24), 4000)
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

  const primaryVehicle = vehicles[0] || null
  const agencyRank = num(dashboard?.agencyRank)
  const agencyName = agencyView.name || 'AGENSI TANPA NAMA'
  const country = agencyView.country || 'TIDAK DIKETAHUI'
  const directorName = user?.email ? `DIR. ${toUpper(user.email.split('@')[0])}` : 'DIR. TANPA NAMA'

  const ap = num(agencyView.ap)
  const budget = num(agencyView.budget)
  const rp = num(agencyView.rp)
  const ipi = num(agencyView.ipi)
  const si = num(agencyView.si)
  const slr = num(agencyView.slr)
  const totalLaunches = num(agencyView.total_launches)
  const successfulLaunches = num(agencyView.successful_launches)

  const siState = stabilityState(si)
  const budgetFlag = budgetState(budget)

  const metrics = [
    { label: 'AP RESERVE', value: `${ap} / ${MAX_AP}`, state: ap >= 10 ? 'NOMINAL' : 'LOW', tone: 'text-flight-amber', stateTone: ap >= 10 ? 'text-phosphor-teal' : 'text-alert-red' },
    { label: 'BUDGET FEED', value: `${budget} U`, state: budgetFlag.label, tone: 'text-phosphor-teal', stateTone: budget >= 15 ? 'text-phosphor-teal' : 'text-alert-red' },
    { label: 'RESEARCH RP', value: `${rp} RP`, state: agencyRank ? `RANK #${agencyRank}` : '—', tone: 'text-telemetry-cyan', stateTone: 'text-neutral-400' },
    { label: 'STABILITY SI', value: `${si}%`, state: siState.label, tone: 'text-neutral-200', stateTone: si >= 30 ? 'text-phosphor-teal' : 'text-alert-red' },
  ]

  const reliability = primaryVehicle ? num(primaryVehicle.reliability) : 0
  const checklist = [
    { label: 'Stage 1 Booster', ok: Boolean(primaryVehicle), state: primaryVehicle ? 'GO' : 'NONE' },
    { label: 'AP Reserve', ok: ap >= 10, state: ap >= 10 ? 'GO' : 'HOLD' },
    { label: 'Budget Feed', ok: budget >= 15, state: budget >= 15 ? 'GO' : 'LOW' },
    { label: 'Vehicle Reliability', ok: Boolean(primaryVehicle) && reliability >= 70, state: primaryVehicle ? `${Math.round(reliability)}%` : 'N/A' },
    { label: 'Stability Index', ok: si >= 30, state: si >= 30 ? 'NOMINAL' : 'KRISIS' },
    { label: 'Range Radar', ok: true, state: 'LOCKED' },
    { label: 'Helium Purge', ok: true, state: 'VERIFIED' },
    { label: 'Flight Readiness', ok: slr >= 50, state: slr >= 50 ? 'READY' : 'CALIBRATING' },
  ]
  const readyCount = checklist.filter((item) => item.ok).length

  const rankingRows = useMemo(() => {
    const top = ranking.slice(0, 4)
    if (agencyView.id && !top.some((row) => row.id === agencyView.id)) {
      const own = ranking.find((row) => row.id === agencyView.id)
      if (own) top.push(own)
    }
    return top
  }, [agencyView.id, ranking])

  const generateName = (prefix) => `${prefix}-${String(Date.now()).slice(-5)}`
  const agencyId = agencyView.id

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
        pushLine('data', '  /bersih                         - kosongkan buffer')
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
          pushLine('ok', `> RESEARCH STARTED: ${toUpper(result.technology)} // DURASI ${result.durationDays} HARI`)
          pushLine('data', `> SALDO: AP ${result.newAp} / BUDGET ${result.newBudget} U`)
          await loadDashboard({ silent: true })
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
          pushLine('ok', `> VEHICLE PRODUCED: ${toUpper(result.vehicle.name)} // RELIABILITY ${result.vehicle.reliability}%`)
          pushLine('data', `> SALDO: AP ${result.newAp} / BUDGET ${result.newBudget} U`)
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
          const simulation = result.simulation || {}
          pushLine(
            simulation.success ? 'ok' : 'error',
            `> MISSION ${simulation.success ? 'SUCCESS' : 'FAILURE'} // SCORE ${Math.round(num(simulation.finalScore))}`,
          )
          pushLine(
            simulation.success ? 'ok' : 'warn',
            `> RP ${signed(simulation.rpGain)} // IPI ${signed(simulation.ipiChange)} // SI ${signed(simulation.siChange)}`,
          )
          if (num(simulation.crewDeaths) > 0) {
            pushLine('error', `> CREW LOSSES: ${simulation.crewDeaths}`)
          }
          pushLine(
            'data',
            `> SALDO: AP ${result.newStats.ap} / BUDGET ${result.newStats.budget} U / RP ${result.newStats.rp}`,
          )
          await loadDashboard({ silent: true })
        } else {
          throw new Error(`DIRECTIVE TIDAK DIKENAL: ${directive} // GUNAKAN /bantuan`)
        }
      } catch (err) {
        pushLine('error', `> ERROR: ${toUpper(err.message || 'EXECUTION FAILED')}`)
      } finally {
        setCommandBusy(false)
      }
    },
    [agencyId, commandBusy, loadDashboard, primaryVehicle, pushLine],
  )

  const handleCommandSubmit = (event) => {
    event.preventDefault()
    if (commandBusy) return
    const value = command
    setCommand('')
    runCommand(value)
  }

  const focusTerminal = useCallback((prefix = '') => {
    setCommand(prefix)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [])

  const handleHold = () => {
    const next = !countdownPaused
    setCountdownPaused(next)
    pushLine(
      next ? 'warn' : 'ok',
      next ? '> COUNTDOWN HOLD // SEQUENCE PAUSED' : '> COUNTDOWN RESUME // SEQUENCE RELEASED',
    )
  }

  const handleLaunch = () => {
    if (commandBusy) return
    if (!primaryVehicle) {
      pushLine('error', '> TIDAK ADA VEHICLE DI HANGAR BAY // /produksi orbital-rocket VALORIA-MKII')
      focusTerminal('/produksi orbital-rocket ')
      return
    }
    runCommand(`/luncurkan test ${generateName('MISI-UJI')}`)
  }

  const handleAbort = () => {
    setCountdownPaused(true)
    pushLine('error', '> ABORT PROTOCOL ENGAGED // TIDAK ADA DATA MISI YANG DIKIRIM')
    setNotice('ABORT PROTOCOL: COUNTDOWN DITAHAN. SIMULASI MISI TIDAK DIJALANKAN.')
  }

  const showModuleNotice = (moduleName) => {
    setNotice(`MODUL ${toUpper(moduleName)} BELUM TERPASANG // DIJADWALKAN PADA CYCLE BERIKUTNYA`)
    pushLine('warn', `> MODULE UNAVAILABLE: ${toUpper(moduleName)} // STUB CYCLE ${CYCLE}`)
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

  const handleLogout = () => {
    localStorage.removeItem('afm_user')
    localStorage.removeItem('afm_session')
    localStorage.removeItem('afm_agency')
    navigate('/login')
  }

  if (loading) {
    return (
      <div className="afm-dashboard min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-xl border border-carbon-border bg-carbon-surface">
          <div className="border-b border-carbon-border bg-carbon-container px-4 py-2 flex items-center justify-between">
            <span className="text-[11px] font-headline uppercase tracking-widest text-telemetry-cyan">AFM-OS BOOT SEQUENCE</span>
            <span className="text-[10px] text-neutral-500">IBM-7090 // 64K</span>
          </div>
          <div className="retro-scanlines bg-carbon-bg p-4 text-xs text-phosphor-teal space-y-1 min-h-[160px]">
            <div className="text-neutral-500">// CORE LOAD... OK</div>
            <div className="text-neutral-500">// CHANNEL 1200 BPS... OK</div>
            <div className="text-neutral-400">// HANDSHAKE /agency/{String(user?.id || '').slice(0, 8) || '--------'}</div>
            <div className="text-flight-amber">
              // MENUNGGU RESPONS MCC<span className="afm-cursor ml-2" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="afm-dashboard min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-xl border border-alert-red/50 bg-carbon-surface">
          <div className="border-b border-alert-red/40 bg-carbon-container px-4 py-2 flex items-center justify-between">
            <span className="text-[11px] font-headline uppercase tracking-widest text-alert-red">SYSTEM FAULT // CONNECTION LOST</span>
            <span className="text-[10px] text-neutral-500">SYS.1969</span>
          </div>
          <div className="bg-carbon-bg p-4 text-xs text-alert-red space-y-2">
            <div>&gt; ERROR: {toUpper(error)}</div>
            <div className="text-neutral-500">// MCC TIDAK MERESPONS ATAU SESSION EXPIRED</div>
          </div>
          <div className="border-t border-carbon-border px-4 py-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleLogout}
              className="border border-carbon-border text-neutral-400 hover:text-neutral-200 hover:bg-carbon-container px-3 py-1.5 text-[10px] uppercase tracking-wider bezier-fast"
            >
              LOGOUT
            </button>
            <button
              type="button"
              onClick={() => loadDashboard()}
              className="bg-flight-amber hover:bg-flight-amber-dim text-black px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border border-flight-amber bezier-fast"
            >
              RETRY HANDSHAKE
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="afm-dashboard min-h-screen flex flex-col text-neutral-300 font-mono antialiased">
      <header className="sticky top-0 z-50 max-[1100px]:static bg-carbon-bg/95 border-b border-carbon-border backdrop-blur-md">
        <div className="bg-carbon-bg border-b border-carbon-border px-4 py-1 flex items-center justify-between gap-4 text-[11px] tracking-wider overflow-x-auto custom-scroll">
          <div className="flex items-center gap-3 min-w-max">
            <span className="inline-flex items-center gap-1.5 text-telemetry-cyan font-bold">
              <span className="h-1.5 w-1.5 bg-telemetry-cyan animate-pulse" />
              SYS.1969 // FLIGHT TERMINAL ONLINE
            </span>
            <span className="text-neutral-600">//</span>
            <span className="text-neutral-400 hidden sm:inline">BAUD RATE: 1200 BPS IBM-7090 CHANNEL</span>
            <span className="text-neutral-600 hidden md:inline">//</span>
            <span className="text-neutral-400 hidden md:inline">GM BROADCAST: SPACE RACE CYCLE {CYCLE} ACTIVE</span>
          </div>
          <div className="flex items-center gap-4 text-flight-amber font-bold tracking-widest text-xs min-w-max">
            <span className="bg-carbon-surface border border-flight-amber/40 px-2 py-0.5 text-[10px]">
              SIM CLOCK: OCT 1969 // T+{formatClock(clock)}
            </span>
            <span className="h-1.5 w-1.5 bg-phosphor-teal" />
          </div>
        </div>

        <div className="px-4 py-2 bg-carbon-surface border-b border-carbon-border flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="bg-carbon-container text-telemetry-cyan px-2.5 py-1 font-headline font-bold text-xs tracking-widest uppercase border border-telemetry-cyan/40 flex items-center gap-2">
              <span className="material-symbols-outlined text-sm">satellite_alt</span>
              ARCADIA : AFM
            </div>
            <div className="hidden sm:flex flex-col border-l border-carbon-border pl-3">
              <span className="text-[9px] uppercase tracking-widest text-neutral-500">AFFILIATION DOSSIER</span>
              <span className="text-xs font-headline font-semibold text-neutral-200">
                {toUpper(agencyName)} [{toUpper(country)}]
              </span>
            </div>
            <span className="bg-carbon-container text-neutral-400 text-[10px] px-2 py-0.5 border border-carbon-border uppercase">
              {powerTier(ipi, si)}
            </span>
            <span className="bg-carbon-container text-telemetry-cyan text-[10px] px-2 py-0.5 border border-telemetry-cyan/30 uppercase font-semibold">
              Cycle {CYCLE}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <div className="text-[9px] uppercase tracking-widest text-neutral-500">CHIEF FLIGHT DIRECTOR</div>
              <div className="text-xs font-semibold text-neutral-200">{directorName}</div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="border border-alert-red/50 text-alert-red hover:bg-alert-red/10 px-2.5 py-1 text-[10px] uppercase tracking-wider bezier-fast flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-sm">logout</span>
              LOGOUT
            </button>
            <div className="w-7 h-7 bg-carbon-container border border-carbon-border-light flex items-center justify-center text-telemetry-cyan">
              <span className="material-symbols-outlined text-[16px]">badge</span>
            </div>
          </div>
        </div>

        <div className="px-3 bg-carbon-bg border-b border-carbon-border overflow-x-auto py-1.5 custom-scroll">
          <div className="flex items-center gap-2 min-w-max text-xs">
            <div className="flex items-center gap-2 border-r border-carbon-border pr-4">
              <span className="text-neutral-500 text-[10px] uppercase tracking-wider">ACTION POINTS (AP):</span>
              <span className="font-bold text-flight-amber bg-carbon-surface border border-flight-amber/40 px-1.5 py-0.5">{ap} / {MAX_AP}</span>
              <span className="text-[10px] text-neutral-500">[+5 PER CYCLE]</span>
            </div>
            <div className="flex items-center gap-2 border-r border-carbon-border pr-4">
              <span className="text-neutral-500 text-[10px] uppercase tracking-wider">BUDGET:</span>
              <span className="font-bold text-phosphor-teal bg-carbon-surface border border-phosphor-teal/30 px-1.5 py-0.5">{budget} U</span>
              <span className={`bg-carbon-container text-[10px] font-bold px-1 py-0.5 border ${budgetFlag.tone}`}>STATE: {budgetFlag.label}</span>
            </div>
            <div className="flex items-center gap-2 border-r border-carbon-border pr-4">
              <span className="text-neutral-500 text-[10px] uppercase tracking-wider">RANKING POINTS:</span>
              <span className="font-bold text-telemetry-cyan">{rp} RP</span>
              <span className="text-[10px] bg-carbon-container text-telemetry-cyan border border-telemetry-cyan/40 px-1 py-0.5 font-bold">
                RANK {agencyRank ? `#${agencyRank}` : '—'}
              </span>
            </div>
            <div className="flex items-center gap-2 border-r border-carbon-border pr-4">
              <span className="text-neutral-500 text-[10px] uppercase tracking-wider">STABILITY (SI):</span>
              <span className="font-bold text-neutral-200">{si}%</span>
              <span className={`text-[10px] bg-carbon-surface border px-1 py-0.5 font-bold ${siState.tone}`}>[{siState.label}]</span>
            </div>
            <div className="flex items-center gap-2 border-r border-carbon-border pr-4">
              <span className="text-neutral-500 text-[10px] uppercase tracking-wider">PRESTIGE (IPI):</span>
              <span className="font-bold text-neutral-200">{ipi}%</span>
              <span className="bg-carbon-container text-telemetry-cyan text-[10px] px-1 py-0.5 border border-carbon-border">
                {ipi >= 60 ? 'SUPPORT KUAT' : ipi >= 40 ? 'STABIL' : 'LEMAH'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-neutral-500 text-[10px] uppercase tracking-wider">SUCCESS RATE:</span>
              <span className="font-bold text-flight-amber">{slr}%</span>
              <span className="text-[10px] text-neutral-500">({successfulLaunches}/{totalLaunches} LAUNCHES)</span>
            </div>
          </div>
        </div>

        <nav className="px-4 bg-carbon-surface flex items-center gap-2 overflow-x-auto py-1 custom-scroll">
          <button
            type="button"
            onClick={openFlight}
            aria-current={view === 'flight' ? 'page' : undefined}
            className={`px-3 py-1 text-xs uppercase tracking-wider border flex items-center gap-1.5 whitespace-nowrap bezier-fast ${
              view === 'flight'
                ? 'border-telemetry-cyan/60 bg-carbon-container text-telemetry-cyan font-bold'
                : 'border-carbon-border text-neutral-400 hover:text-neutral-200 hover:border-carbon-border-light hover:bg-carbon-container'
            }`}
          >
            {view === 'flight' && <span className="h-1.5 w-1.5 bg-telemetry-cyan animate-pulse" />}
            MISSION CONTROL
          </button>
          <button
            type="button"
            onClick={() => openEngineering('tech')}
            aria-current={view === 'engineering' && engineeringTab !== 'hangar' ? 'page' : undefined}
            className={`px-3 py-1 text-xs uppercase tracking-wider border flex items-center gap-1.5 whitespace-nowrap bezier-fast ${
              view === 'engineering' && engineeringTab !== 'hangar'
                ? 'border-telemetry-cyan/60 bg-carbon-container text-telemetry-cyan font-bold'
                : 'border-carbon-border text-neutral-400 hover:text-neutral-200 hover:border-carbon-border-light hover:bg-carbon-container'
            }`}
          >
            {view === 'engineering' && engineeringTab !== 'hangar' && (
              <span className="h-1.5 w-1.5 bg-telemetry-cyan animate-pulse" />
            )}
            R&amp;D / TECH TREE
          </button>
          <button
            type="button"
            onClick={() => openEngineering('hangar')}
            aria-current={view === 'engineering' && engineeringTab === 'hangar' ? 'page' : undefined}
            className={`px-3 py-1 text-xs uppercase tracking-wider border flex items-center gap-1.5 whitespace-nowrap bezier-fast ${
              view === 'engineering' && engineeringTab === 'hangar'
                ? 'border-flight-amber/60 bg-carbon-container text-flight-amber font-bold'
                : 'border-carbon-border text-neutral-400 hover:text-neutral-200 hover:border-carbon-border-light hover:bg-carbon-container'
            }`}
          >
            {view === 'engineering' && engineeringTab === 'hangar' && (
              <span className="h-1.5 w-1.5 bg-flight-amber animate-pulse" />
            )}
            HANGAR &amp; PRODUKSI
          </button>
          {['GLOBAL RACE & DIPLOMASI', 'AGENCY DOSSIER'].map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => showModuleNotice(label)}
              className="px-3 py-1 text-xs uppercase tracking-wider border border-carbon-border text-neutral-400 hover:text-neutral-200 hover:border-carbon-border-light hover:bg-carbon-container bezier-fast whitespace-nowrap"
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="w-full px-4 pt-4 pb-28 flex-1">
        {notice && (
          <div className="mb-4 border border-flight-amber/50 bg-flight-amber/10 text-flight-amber px-4 py-2 text-[10px] uppercase tracking-wider">
            {notice}
          </div>
        )}

        {view === 'flight' ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border border-carbon-border bg-carbon-surface px-4 py-2 mb-4 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-telemetry-cyan animate-pulse" />
                <span className="text-neutral-200 font-headline font-bold uppercase tracking-wider">
                  KONSOL OTORISASI PENERBANGAN // DIREKTORAT {toUpper(country)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-neutral-400 text-[11px]">
                <span>KONSOL: <span className="text-neutral-200 font-semibold">FLIGHT-DIR-ALPHA</span></span>
                <span className="text-neutral-600">//</span>
                <span>STASIUN BUMI: <span className="text-neutral-200 font-semibold">CAPE MERIDIAN (08°24'N, 77°11'E)</span></span>
                <span className="text-neutral-600">//</span>
                <span className="text-phosphor-teal border border-phosphor-teal/40 px-1.5 py-0.5 text-[10px] font-bold">CYCLE {CYCLE} ACTIVE</span>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <div className="xl:col-span-8 flex flex-col gap-4">
            <section className="bg-carbon-surface border border-carbon-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-carbon-border pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <span className="bg-carbon-container text-alert-red border border-alert-red/50 text-[10px] font-bold px-2 py-0.5 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-alert-red animate-ping" />
                    LIVE FEED
                  </span>
                  <h2 className="font-headline font-bold text-sm text-neutral-100 uppercase tracking-wider">
                    LAUNCH COMPLEX 39-B // PAD-01 DIRECTIVE
                  </h2>
                </div>
                <div className="flex items-center gap-3 font-bold text-xs text-flight-amber bg-carbon-container border border-flight-amber/40 px-3 py-1">
                  <span className="material-symbols-outlined text-sm">alarm</span>
                  <span className="tracking-widest">COUNTDOWN: T - {formatClock(countdown)}</span>
                  {countdownPaused && <span className="text-alert-red text-[10px]">HOLD</span>}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-5 bg-carbon-bg border border-carbon-border flex flex-col">
                  <div
                    className="w-full h-48 relative bg-cover bg-center border-b border-carbon-border"
                    style={{ backgroundImage: `url(${launchPad})` }}
                  >
                    <div className="absolute inset-0 bg-carbon-bg/60 mix-blend-multiply" />
                    <div className="absolute top-2 left-2 bg-carbon-bg/90 text-telemetry-cyan text-[9px] border border-carbon-border px-1.5 py-0.5 uppercase">
                      CAM-01 GENTRY NORTH
                    </div>
                    <div className="absolute bottom-2 right-2 bg-carbon-bg/90 text-flight-amber border border-flight-amber/40 text-[9px] px-1.5 py-0.5">
                      MCC CAPE MERIDIAN
                    </div>
                  </div>
                  <div className="p-3 bg-carbon-container text-xs space-y-1.5 flex-1 flex flex-col justify-center">
                    <InfoRow label="VEHICLE" value={primaryVehicle ? toUpper(primaryVehicle.name) : 'NO VEHICLE'} />
                    <InfoRow
                      label="PAYLOAD"
                      value={primaryVehicle ? VEHICLE_LABEL[primaryVehicle.type] || titleCase(primaryVehicle.type) : 'STANDBY'}
                    />
                    <InfoRow label="INJECTION" value="LEO 240 KM (CIRCULAR)" tone="text-phosphor-teal" />
                    <InfoRow
                      label="STATUS"
                      value={primaryVehicle ? toUpper(primaryVehicle.status || 'TESTING') : 'AWAITING ASSEMBLY'}
                      tone={primaryVehicle ? 'text-phosphor-teal' : 'text-flight-amber'}
                    />
                  </div>
                </div>

                <div className="lg:col-span-7 flex flex-col justify-between gap-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {metrics.map((metric) => (
                      <div key={metric.label} className="border border-carbon-border bg-carbon-container p-2 text-center">
                        <span className="text-[9px] text-neutral-500 block uppercase">{metric.label}</span>
                        <span className={`font-headline font-bold text-sm ${metric.tone}`}>{metric.value}</span>
                        <span className={`text-[9px] block mt-0.5 font-semibold ${metric.stateTone}`}>{metric.state}</span>
                      </div>
                    ))}
                  </div>

                  <div className="border border-carbon-border bg-carbon-container p-3">
                    <div className="flex items-center justify-between text-xs font-bold text-neutral-200 border-b border-carbon-border pb-2 mb-2 uppercase">
                      <span className="text-neutral-300">STAGE PRE-FLIGHT CHECKLIST</span>
                      <span className="text-[10px] bg-carbon-surface text-phosphor-teal border border-phosphor-teal/40 px-1.5 py-0.5">
                        {readyCount}/{checklist.length} GO
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                      {checklist.map((item) => (
                        <div key={item.label} className="flex items-center gap-2 min-w-0">
                          <span
                            className={`w-2.5 h-2.5 shrink-0 border flex items-center justify-center ${
                              item.ok ? 'border-phosphor-teal bg-phosphor-teal/20' : 'border-alert-red bg-alert-red/20'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 ${item.ok ? 'bg-phosphor-teal' : 'bg-alert-red'}`} />
                          </span>
                          <span className="text-neutral-400 flex-1 truncate">{item.label}:</span>
                          <span className={item.ok ? 'text-neutral-200' : 'text-alert-red'}>{item.state}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <div className="bg-carbon-container border border-carbon-border px-3 py-2 text-[10px] flex items-center gap-2 flex-1 min-w-[190px] whitespace-nowrap">
                      <span className="text-neutral-500 uppercase">AP ALLOC:</span>
                      <span className="font-bold text-flight-amber text-xs">10 AP</span>
                      <span className="text-neutral-600">//</span>
                      <span className="text-neutral-400">COST: 15 U</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleLaunch}
                      disabled={commandBusy}
                      className="bg-flight-amber hover:bg-flight-amber-dim disabled:opacity-60 disabled:cursor-not-allowed text-black font-bold text-xs uppercase px-4 py-2 border border-flight-amber flex items-center gap-1.5 bezier-fast"
                    >
                      <span className="material-symbols-outlined text-sm font-bold">rocket_launch</span>
                      AUTORISASI LUNCUR
                    </button>
                    <button
                      type="button"
                      onClick={handleHold}
                      className="bg-carbon-container hover:bg-carbon-subtle text-neutral-300 text-xs uppercase px-3 py-2 border border-carbon-border bezier-fast"
                    >
                      {countdownPaused ? 'RESUME COUNT' : 'HOLD COUNT'}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <article className="bg-carbon-surface border border-carbon-border flex flex-col">
                <div className="bg-carbon-container border-b border-carbon-border px-3 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-telemetry-cyan" />
                    <span className="font-headline font-bold text-xs text-neutral-200 uppercase tracking-wider">VT-100 CONSOLE</span>
                  </div>
                  <span className="text-[10px] text-neutral-500">64KB OK // IBM-7090</span>
                </div>

                <div
                  ref={consoleRef}
                  className="p-3 bg-carbon-bg retro-scanlines border-b border-carbon-border text-xs text-phosphor-teal h-[220px] overflow-y-auto custom-scroll flex flex-col"
                >
                  <div className="space-y-0.5 mt-auto">
                    {consoleLines.length === 0 && <div className="text-neutral-600">// BUFFER CLEAR</div>}
                    {consoleLines.map((line) => (
                      <ConsoleLine key={line.id} line={line} />
                    ))}
                  </div>
                </div>

                <div className="px-3 pt-2 flex flex-wrap gap-1.5">
                  {QUICK_COMMANDS.map((quick) => (
                    <button
                      key={quick.label}
                      type="button"
                      onClick={() => focusTerminal(quick.prefix)}
                      className="border border-carbon-border text-neutral-400 hover:text-telemetry-cyan hover:border-telemetry-cyan/40 hover:bg-carbon-container px-1.5 py-0.5 text-[10px] bezier-fast"
                    >
                      {quick.label}
                    </button>
                  ))}
                </div>

                <form onSubmit={handleCommandSubmit} className="p-3 flex items-center gap-1.5 text-xs">
                  <span className="text-telemetry-cyan font-bold shrink-0">VALORIA@MCC-1969:~$</span>
                  <input
                    ref={inputRef}
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                    placeholder="/bantuan"
                    spellCheck={false}
                    autoComplete="off"
                    aria-label="Terminal command"
                    className="flex-1 min-w-0 bg-transparent border-0 text-neutral-100 px-0 py-0 text-xs placeholder:text-neutral-600"
                  />
                  <button
                    type="submit"
                    disabled={commandBusy}
                    className="bg-carbon-container border border-telemetry-cyan/40 text-telemetry-cyan hover:bg-telemetry-cyan/10 disabled:opacity-50 px-2.5 py-1 text-[10px] font-bold uppercase bezier-fast"
                  >
                    {commandBusy ? 'BUSY' : 'EXEC'}
                  </button>
                </form>
              </article>

              <article className="bg-carbon-surface border border-carbon-border flex flex-col">
                <div className="bg-carbon-container border-b border-carbon-border px-3 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-flight-amber" />
                    <span className="font-headline font-bold text-xs text-neutral-200 uppercase tracking-wider">AGM EVENT STREAM</span>
                  </div>
                  <span className="text-[10px] text-neutral-500">{logs.length} ENTRIES</span>
                </div>

                <div className="flex-1 max-h-[300px] overflow-y-auto custom-scroll divide-y divide-carbon-border/60">
                  {logs.length === 0 ? (
                    <div className="p-4 text-[11px] text-neutral-500">
                      // TIDAK ADA EVENT TERCATAT
                      <br />
                      // JALANKAN DIRECTIVE PERTAMA DARI VT-100
                    </div>
                  ) : (
                    logs.slice(0, 10).map((log) => (
                      <div key={log.id} className="px-3 py-2 text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`font-bold ${eventTone(log.event_type)}`}>{toUpper(log.event_type || 'EVENT')}</span>
                          <span className="text-neutral-500">{formatTime(log.created_at)}</span>
                        </div>
                        <p className="text-neutral-400 mt-0.5 leading-snug">{log.description}</p>
                      </div>
                    ))
                  )}
                </div>

                <div className="border-t border-carbon-border px-3 py-1.5 flex items-center justify-between text-[10px] text-neutral-500">
                  <span>AGM ENGINE // DETERMINISTIC SIM</span>
                  <span className="text-phosphor-teal">ONLINE</span>
                </div>
              </article>
            </section>
          </div>

          <div className="xl:col-span-4 flex flex-col gap-4">
            <article className="bg-carbon-surface border border-carbon-border flex flex-col">
              <div className="bg-carbon-container border-b border-carbon-border px-3 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-telemetry-cyan" />
                  <span className="font-headline font-bold text-xs text-neutral-200 uppercase tracking-wider">ORBIT TRACK // LEO</span>
                </div>
                <span className="text-[10px] text-telemetry-cyan">{primaryVehicle ? 'SYNC PASS' : 'IDLE'}</span>
              </div>

              <div className="relative bg-carbon-bg border-b border-carbon-border h-44 overflow-hidden">
                <svg viewBox="0 0 400 200" className="w-full h-full" aria-hidden="true">
                  <defs>
                    <pattern id="afm-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#23272F" strokeWidth="1" />
                    </pattern>
                  </defs>
                  <rect width="400" height="200" fill="url(#afm-grid)" />
                  <path d="M30 140 L80 110 L120 125 L165 90 L210 105 L250 70 L300 95 L360 60" fill="none" stroke="#2E3440" strokeWidth="10" strokeLinejoin="round" />
                  <path d="M20 90 L70 75 L110 95 L150 60 L200 80 L240 50 L290 68 L355 45" fill="none" stroke="#2E3440" strokeWidth="6" strokeLinejoin="round" />
                  <ellipse cx="200" cy="100" rx="165" ry="66" fill="none" stroke="#00E5FF" strokeOpacity="0.35" strokeDasharray="4 4" />
                  <ellipse cx="200" cy="100" rx="165" ry="66" fill="none" stroke="#2DD4BF" strokeOpacity="0.18" strokeWidth="8" />
                  <path d="M42 118 C 120 40, 280 160, 358 82" fill="none" stroke="#2DD4BF" strokeWidth="1.2" strokeDasharray="2 3" />
                  <circle cx="42" cy="118" r="3" fill="#F5A623" />
                  <circle cx="88" cy="78" r="2" fill="#00E5FF" opacity="0.7" />
                  <circle cx="312" cy="128" r="2" fill="#00E5FF" opacity="0.7" />
                  <circle cx="200" cy={primaryVehicle ? '34' : '100'} r={primaryVehicle ? '4' : '3'} fill={primaryVehicle ? '#00E5FF' : '#4B5563'} />
                  <text x="208" y={primaryVehicle ? '30' : '96'} fill="#00E5FF" fontSize="8" fontFamily="JetBrains Mono, monospace">
                    {primaryVehicle ? toUpper(primaryVehicle.name).slice(0, 14) : 'NO ASSET'}
                  </text>
                  <text x="46" y="132" fill="#F5A623" fontSize="7" fontFamily="JetBrains Mono, monospace">
                    CAPE MERIDIAN
                  </text>
                </svg>
                <div className="absolute left-2 bottom-2 text-[9px] text-neutral-500">AFM TRACKING // DSN-14</div>
                <div className="absolute top-2 right-2 text-[9px] text-neutral-500">LEO 240 KM</div>
              </div>

              <div className="grid grid-cols-2">
                <OrbitStat label="DOWNLINK" value={primaryVehicle ? 'LOCKED' : 'STANDBY'} tone={primaryVehicle ? 'text-phosphor-teal' : 'text-neutral-400'} />
                <OrbitStat label="TELEMETRY" value={`${Math.round(latency)} MS`} tone="text-telemetry-cyan" />
                <OrbitStat label="LAUNCHES" value={totalLaunches} />
                <OrbitStat label="SUCCESS RATE" value={`${slr}%`} tone="text-flight-amber" />
              </div>
            </article>

            <article className="bg-carbon-surface border border-carbon-border">
              <div className="bg-carbon-container border-b border-carbon-border px-3 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-flight-amber" />
                  <span className="font-headline font-bold text-xs text-neutral-200 uppercase tracking-wider">GLOBAL RACE // TOP AGENCIES</span>
                </div>
                <span className="text-[10px] text-neutral-500">RP</span>
              </div>

              <div className="divide-y divide-carbon-border/60">
                {rankingRows.length === 0 ? (
                  <div className="px-3 py-3 text-[11px] text-neutral-500">// BELUM ADA DATA RANKING</div>
                ) : (
                  rankingRows.map((row) => {
                    const own = row.id === agencyView.id
                    return (
                      <div key={row.id} className={`flex items-center gap-2 px-3 py-2 text-[11px] ${own ? 'bg-carbon-container' : ''}`}>
                        <span className={`w-6 text-center font-bold ${num(row.rank) <= 3 ? 'text-flight-amber' : 'text-neutral-500'}`}>#{row.rank}</span>
                        <span className={`flex-1 truncate ${own ? 'text-telemetry-cyan font-semibold' : 'text-neutral-300'}`}>{toUpper(row.name)}</span>
                        <span className="text-neutral-500 text-[10px] hidden sm:inline">{toUpper(row.country || '—')}</span>
                        <span className="text-flight-amber font-bold">{row.rp} RP</span>
                      </div>
                    )
                  })
                )}
              </div>

              <button
                type="button"
                onClick={() => showModuleNotice('GLOBAL RACE & DIPLOMASI')}
                className="w-full border-t border-carbon-border px-3 py-2 text-[10px] uppercase tracking-wider text-neutral-400 hover:text-neutral-200 hover:bg-carbon-container bezier-fast"
              >
                BUKA PETA DIPLOMASI
              </button>
            </article>

            <article className="bg-carbon-surface border border-carbon-border">
              <div className="bg-carbon-container border-b border-carbon-border px-3 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-phosphor-teal" />
                  <span className="font-headline font-bold text-xs text-neutral-200 uppercase tracking-wider">HANGAR BAY 2 // VEHICLES</span>
                </div>
                <span className="text-[10px] text-neutral-500">{vehicles.length} UNIT</span>
              </div>

              <div className="p-3 space-y-3">
                {vehicles.length === 0 ? (
                  <div className="border border-dashed border-carbon-border p-4 text-center text-[11px] text-neutral-500">
                    HANGAR KOSONG
                    <br />
                    BUKA MODUL HANGAR UNTUK FABRIKASI WAHANA
                  </div>
                ) : (
                  vehicles.slice(0, 3).map((vehicle) => (
                    <div key={vehicle.id} className="border border-carbon-border bg-carbon-container p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-neutral-100 truncate">{toUpper(vehicle.name)}</span>
                        <span className="text-[9px] text-telemetry-cyan border border-telemetry-cyan/40 px-1.5 py-0.5 uppercase whitespace-nowrap">
                          {titleCase(vehicle.type)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-neutral-500 mt-1">
                        <span>RELIABILITY</span>
                        <span className="text-neutral-200 font-bold">{Math.round(num(vehicle.reliability))}%</span>
                      </div>
                      <div className="h-1.5 bg-carbon-bg border border-carbon-border mt-1">
                        <div
                          className="h-full bg-gradient-to-r from-carbon-border-light to-phosphor-teal"
                          style={{ width: `${clamp(vehicle.reliability)}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}

                <button
                  type="button"
                  onClick={() => openEngineering('hangar')}
                  className="w-full border border-telemetry-cyan/50 text-telemetry-cyan hover:bg-telemetry-cyan/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider bezier-fast flex items-center justify-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-sm">precision_manufacturing</span>
                  BUKA HANGAR &amp; FABRIKASI
                </button>
              </div>
            </article>
          </div>
            </div>
          </>
        ) : (
          <Engineering
            agencyId={agencyId}
            agencyName={agencyName}
            ap={ap}
            budget={budget}
            rp={rp}
            si={si}
            vehicles={vehicles}
            logs={logs}
            tab={engineeringTab}
            onTabChange={setEngineeringTab}
            onExit={openFlight}
            onRefresh={() => loadDashboard({ silent: true })}
            pushLine={pushLine}
            notify={setNotice}
            apiRequest={apiRequest}
          />
        )}
      </main>

      <footer className="fixed bottom-0 left-0 w-full z-50 border-t border-carbon-border bg-carbon-bg/95 backdrop-blur-md px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {view === 'flight' ? (
              <>
                <button
                  type="button"
                  onClick={() => focusTerminal('/luncurkan test ')}
                  className="bg-flight-amber hover:bg-flight-amber-dim text-black border border-flight-amber px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bezier-fast flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-sm">rocket_launch</span>
                  LAUNCH MISSION
                </button>
                <button
                  type="button"
                  onClick={() => openEngineering('tech')}
                  className="bg-carbon-container hover:bg-carbon-subtle text-telemetry-cyan border border-telemetry-cyan/40 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bezier-fast flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-sm">science</span>
                  RESEARCH TECH
                </button>
                <button
                  type="button"
                  onClick={() => openEngineering('hangar')}
                  className="bg-carbon-container hover:bg-carbon-subtle text-neutral-300 border border-carbon-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bezier-fast flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-sm">precision_manufacturing</span>
                  ASSEMBLE ROCKET
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={openFlight}
                  className="bg-flight-amber hover:bg-flight-amber-dim text-black border border-flight-amber px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bezier-fast flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-sm">rocket_launch</span>
                  MISSION CONTROL
                </button>
                <button
                  type="button"
                  onClick={() => setEngineeringTab('tech')}
                  className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bezier-fast flex items-center gap-1.5 border ${
                    engineeringTab !== 'hangar'
                      ? 'bg-carbon-container text-telemetry-cyan border-telemetry-cyan/40'
                      : 'bg-carbon-container hover:bg-carbon-subtle text-neutral-400 border-carbon-border'
                  }`}
                >
                  <span className="material-symbols-outlined text-sm">science</span>
                  POHON RISET
                </button>
                <button
                  type="button"
                  onClick={() => setEngineeringTab('hangar')}
                  className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bezier-fast flex items-center gap-1.5 border ${
                    engineeringTab === 'hangar'
                      ? 'bg-carbon-container text-flight-amber border-flight-amber/40'
                      : 'bg-carbon-container hover:bg-carbon-subtle text-neutral-400 border-carbon-border'
                  }`}
                >
                  <span className="material-symbols-outlined text-sm">precision_manufacturing</span>
                  HANGAR BAY
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-3 text-[10px] text-neutral-500">
            <span>LATENCY <span className="text-phosphor-teal font-bold">{Math.round(latency)} MS</span></span>
            <span className="hidden sm:inline text-neutral-600">//</span>
            {view === 'flight' ? (
              <button
                type="button"
                onClick={handleAbort}
                className="border border-alert-red/40 text-alert-red hover:bg-alert-red/10 px-2 py-1 uppercase tracking-wider bezier-fast"
              >
                EMERGENCY ABORT PROTOCOL
              </button>
            ) : (
              <span className="border border-phosphor-teal/30 text-phosphor-teal px-2 py-1 uppercase tracking-wider">
                AGM R&amp;D LINK ACTIVE
              </span>
            )}
            <span className="hidden sm:inline text-neutral-600">AFM v0.1.0</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
