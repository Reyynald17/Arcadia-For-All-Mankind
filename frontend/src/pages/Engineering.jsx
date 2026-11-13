import { useCallback, useEffect, useMemo, useState } from 'react'

const CYCLE = '14'
const MAX_AP = 50
const HANGAR_SLOTS = 4

const VEHICLE_TYPES = ['sounding-rocket', 'orbital-rocket', 'satellite', 'capsule', 'probe', 'lander']

const VEHICLE_LABEL = {
  'sounding-rocket': 'ROKET SONDA',
  'orbital-rocket': 'ROKET ORBITAL',
  satellite: 'SATELIT',
  capsule: 'KAPSUL',
  probe: 'PROBE',
  lander: 'LANDER',
}

const VEHICLE_COST = {
  'sounding-rocket': { ap: 5, budget: 10 },
  'orbital-rocket': { ap: 8, budget: 20 },
  satellite: { ap: 6, budget: 15 },
  capsule: { ap: 10, budget: 30 },
  probe: { ap: 7, budget: 18 },
  lander: { ap: 12, budget: 40 },
}

const VEHICLE_SPEC = {
  'sounding-rocket': { mass: '12.4 TON', thrust: '240 kN', deltaV: '2,100 m/s' },
  'orbital-rocket': { mass: '142.8 TON', thrust: '1,850 kN', deltaV: '9,450 m/s' },
  satellite: { mass: '1.8 TON', thrust: '—', deltaV: '—' },
  capsule: { mass: '5.2 TON', thrust: '—', deltaV: '3,600 m/s' },
  probe: { mass: '2.6 TON', thrust: '—', deltaV: '4,200 m/s' },
  lander: { mass: '18.7 TON', thrust: '—', deltaV: '5,800 m/s' },
}

const TIER_LABEL = {
  1: 'SUB-ORBITAL & ATMOSPHERIC LAUNCH FOUNDATION',
  2: 'EARTH ORBIT INSERTION & MANNED FLIGHT',
  3: 'TRANS-LUNAR INJECTION & DEEP HABITATION',
}

const TECH_DESCRIPTION = {
  'propulsi cair tahap i (lox/rp-1)':
    'Arsitektur mesin bahan bakar ganda bertekanan turbopump gas generator.',
  'telemetri dua arah & radar':
    'Transceiver S-Band omni-directional terintegrasi komputer darat Cape Meridian.',
  'kapsul dua awak valoria-mkii':
    'Kompartemen kabin bertekanan 34 kPa oksigen murni untuk misi durasi panjang LEO.',
  'stage separation & ullage rockets':
    'Pemisahan peledak piroteknik linear dan roket pemampat bahan bakar cair tahap-2.',
  'cryogenic hydrogen stage (lh2/lox)':
    'Propulsi kriogenik efisiensi tinggi (Isp 450s) untuk lintasan injeksi trans-lunar.',
  'heat shield ablatif kecepatan bulan':
    'Pelindung termal resin fenolik mikro-balon tahan atmosfer 11.2 km/s kembalinya kru.',
}

const TECH_EFFECT = {
  'propulsi cair tahap i (lox/rp-1)': '+15% VEHICLE RELIABILITY',
  'telemetri dua arah & radar': '+20% TELEMETRY SIGNAL LOCK',
  'kapsul dua awak valoria-mkii': '+10 CREW CAPACITY',
  'stage separation & ullage rockets': '+8% STAGING RELIABILITY',
  'cryogenic hydrogen stage (lh2/lox)': '+12% TRANS-LUNAR DELTA-V',
  'heat shield ablatif kecepatan bulan': '+15% REENTRY SURVIVABILITY',
}

const STATUS = {
  completed: {
    label: 'TELAH TERBUKA [COMPLETED]',
    tone: 'text-phosphor-teal',
    dot: 'bg-phosphor-teal',
    card: 'border-phosphor-teal/30 bg-carbon-container',
  },
  in_progress: {
    label: 'SEDANG DITELITI [IN PROGRESS]',
    tone: 'text-flight-amber',
    dot: 'bg-flight-amber animate-pulse',
    card: 'border-flight-amber/40 bg-carbon-container',
  },
  qualified: {
    label: 'SIAP DITELITI [QUALIFIED]',
    tone: 'text-telemetry-cyan',
    dot: 'bg-telemetry-cyan',
    card: 'border-telemetry-cyan/30 bg-carbon-container',
  },
  locked: {
    label: 'TERKUNCI [LOCKED]',
    tone: 'text-alert-red',
    dot: 'bg-alert-red',
    card: 'border-carbon-border bg-carbon-surface opacity-80',
  },
}

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

function formatTime(value) {
  if (!value) return '--:--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--'
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${pad(date.getUTCDate())} ${date.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }).toUpperCase()}`
}

function eventTone(type) {
  const value = toUpper(type)
  if (value.includes('FAIL') || value.includes('CRASH')) return 'text-alert-red'
  if (value.includes('COMPLETED') || value.includes('SUCCESS')) return 'text-phosphor-teal'
  if (value.includes('RESEARCH')) return 'text-telemetry-cyan'
  if (value.includes('PRODUCTION')) return 'text-flight-amber'
  return 'text-neutral-300'
}

function eventTechName(log) {
  const data = log?.data
  if (data && typeof data === 'object' && data.technology) return String(data.technology)
  const match = String(log?.description || '').match(/^Research (?:started|completed):\s*(.+)$/i)
  return match ? match[1].trim() : ''
}

function buildResearchEvents(logs) {
  const map = new Map()
  for (const log of logs) {
    const type = toUpper(log.event_type)
    if (!type.startsWith('RESEARCH_')) continue
    const name = eventTechName(log)
    if (!name) continue

    const key = name.toLowerCase()
    const completed = type.includes('COMPLETED') || type.includes('FINISHED')
    const current = map.get(key)
    if (!current) {
      map.set(key, { log, completed })
      continue
    }
    const incomingNewer =
      new Date(log.created_at || 0).getTime() > new Date(current.log.created_at || 0).getTime()
    map.set(key, {
      log: incomingNewer ? log : current.log,
      completed: current.completed || completed,
    })
  }
  return map
}

export default function Engineering({
  agencyId,
  agencyName,
  ap,
  budget,
  rp,
  si,
  vehicles,
  logs,
  tab,
  onTabChange,
  onExit,
  onRefresh,
  pushLine,
  notify,
  apiRequest,
}) {
  const [technologies, setTechnologies] = useState([])
  const [researchLogs, setResearchLogs] = useState(null)
  const [techLoading, setTechLoading] = useState(true)
  const [techError, setTechError] = useState('')
  const [selectedType, setSelectedType] = useState('orbital-rocket')
  const [vehicleName, setVehicleName] = useState('')
  const [researchBusy, setResearchBusy] = useState(null)
  const [productionBusy, setProductionBusy] = useState(false)
  const [, setTick] = useState(0)

  const loadTechnologies = useCallback(async () => {
    if (!agencyId) return
    setTechLoading(true)
    setTechError('')
    try {
      const payload = await apiRequest(`/research/available/${agencyId}`)
      if (Array.isArray(payload)) {
        setTechnologies(payload)
        setResearchLogs(null)
      } else {
        setTechnologies(Array.isArray(payload?.technologies) ? payload.technologies : [])
        setResearchLogs(Array.isArray(payload?.researchLogs) ? payload.researchLogs : [])
      }
    } catch (err) {
      setTechError(err.message || 'Matriks riset tidak dapat dimuat')
      pushLine('error', `> RESEARCH MATRIX FAILED: ${toUpper(err.message || 'UNKNOWN')}`)
    } finally {
      setTechLoading(false)
    }
  }, [agencyId, apiRequest, pushLine])

  useEffect(() => {
    loadTechnologies()
  }, [loadTechnologies])

  useEffect(() => {
    const timer = setInterval(() => setTick((prev) => prev + 1), 30000)
    return () => clearInterval(timer)
  }, [])

  const researchEvents = useMemo(() => buildResearchEvents(researchLogs ?? logs), [logs, researchLogs])
  const completedTechs = useMemo(
    () =>
      new Set(
        [...researchEvents.entries()]
          .filter(([, event]) => event.completed)
          .map(([name]) => name),
      ),
    [researchEvents],
  )

  const techRows = useMemo(() => {
    const counters = {}
    return technologies.map((tech) => {
      const matchedTier = String(tech.era || '').match(/\d+/)
      const tier = matchedTier ? Number(matchedTier[0]) : 1
      counters[tier] = (counters[tier] || 0) + 1

      const prerequisites = Array.isArray(tech.prerequisite) ? tech.prerequisite.filter(Boolean) : []
      const prereqMet = prerequisites.every((name) => completedTechs.has(String(name).toLowerCase()))
      const event = researchEvents.get(String(tech.name || '').toLowerCase())

      let status = 'qualified'
      if (event?.completed) status = 'completed'
      else if (event) status = 'in_progress'
      else if (!prereqMet) status = 'locked'

      return {
        tech,
        tier,
        groupKey: tier <= 2 ? tier : 3,
        nodeCode: `NODE-${tier}${pad(counters[tier])}`,
        prerequisites,
        event,
        status,
      }
    })
  }, [completedTechs, researchEvents, technologies])

  const techGroups = useMemo(() => {
    const groups = new Map()
    for (const row of techRows) {
      if (!groups.has(row.groupKey)) groups.set(row.groupKey, [])
      groups.get(row.groupKey).push(row)
    }
    return [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([key, rows]) => ({
        key,
        badge: key === 3 ? 'TIER 03 & 04' : `TIER ${pad(key)}`,
        label: TIER_LABEL[key] || `TIER ${pad(key)}`,
        rows,
      }))
  }, [techRows])

  const researchCount = techRows.filter((row) => row.status === 'completed').length
  const inProgressCount = techRows.filter((row) => row.status === 'in_progress').length
  const qualifiedCount = techRows.filter((row) => row.status === 'qualified').length

  const primaryVehicle = vehicles[0] || null
  const selectedCost = VEHICLE_COST[selectedType]
  const selectedSpec = VEHICLE_SPEC[selectedType]
  const canAfford = ap >= selectedCost.ap && budget >= selectedCost.budget
  const techBonus = Math.floor(rp / 20)
  const budgetLabel = budget >= 40 ? 'KUAT' : budget >= 15 ? 'CUKUP' : 'TIPIS'
  const siLabel = si >= 70 ? 'NOMINAL' : si >= 30 ? 'WASPADA' : 'KRISIS'
  const blueprintReliability =
    primaryVehicle && primaryVehicle.type === selectedType ? Math.round(num(primaryVehicle.reliability)) : 70
  const autoName = `AUTO-${VEHICLE_LABEL[selectedType].replace(/\s+/g, '-')}`

  const startResearch = async (tech) => {
    if (!agencyId || researchBusy) return
    setResearchBusy(tech.id)
    try {
      const result = await apiRequest('/research/start', {
        method: 'POST',
        body: JSON.stringify({ agencyId, technologyName: tech.name }),
      })
      pushLine(
        'ok',
        `> RESEARCH STARTED: ${toUpper(result.technology || tech.name)} // DURASI ${result.durationDays ?? tech.duration_days} HARI`,
      )
      pushLine('data', `> SALDO: AP ${result.newAp} / BUDGET ${result.newBudget} U`)
      notify(`RISET DIMULAI: ${toUpper(tech.name)} // ALOKASI AP TERDEDUKSI`)
      await Promise.all([onRefresh(), loadTechnologies()])
    } catch (err) {
      pushLine('error', `> RESEARCH ERROR: ${toUpper(err.message || 'UNKNOWN')}`)
      notify(`RISET GAGAL: ${toUpper(err.message || 'UNKNOWN')}`)
    } finally {
      setResearchBusy(null)
    }
  }

  const fabricate = async () => {
    if (!agencyId || productionBusy) return
    if (!canAfford) {
      notify(`FABRIKASI DITOLAK: BUTUH ${selectedCost.ap} AP + ${selectedCost.budget} U`)
      return
    }
    const name = vehicleName.trim() || `${autoName}-${String(Date.now()).slice(-5)}`
    setProductionBusy(true)
    try {
      const result = await apiRequest('/production/vehicle', {
        method: 'POST',
        body: JSON.stringify({ agencyId, vehicleName: name, vehicleType: selectedType }),
      })
      pushLine(
        'ok',
        `> VEHICLE PRODUCED: ${toUpper(result.vehicle?.name || name)} // RELIABILITY ${result.vehicle?.reliability ?? 70}%`,
      )
      pushLine('data', `> SALDO: AP ${result.newAp} / BUDGET ${result.newBudget} U`)
      notify(`FABRIKASI SELESAI: ${toUpper(name)} MASUK HANGAR BAY-02`)
      setVehicleName('')
      await onRefresh()
    } catch (err) {
      pushLine('error', `> FABRICATION ERROR: ${toUpper(err.message || 'UNKNOWN')}`)
      notify(`FABRIKASI GAGAL: ${toUpper(err.message || 'UNKNOWN')}`)
    } finally {
      setProductionBusy(false)
    }
  }

  const techTabActive = tab !== 'hangar'

  return (
    <div>
      <section className="border border-carbon-border bg-carbon-surface mb-4">
        <div className="px-4 py-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-flight-amber font-bold">
              <span className="w-1.5 h-1.5 bg-flight-amber animate-ping" />
              DIVISI REKAYASA &amp; TEKNIK // {toUpper(agencyName)} SPACE FLIGHT CENTER
            </div>
            <h1 className="font-headline font-bold text-lg sm:text-xl uppercase text-neutral-100 tracking-tight mt-1">
              LABORATORIUM RISET ASTRONAUTIKA &amp; HANGAR INTEGRASI
            </h1>
          </div>

          <div className="flex items-center gap-1 bg-carbon-bg p-1 border border-carbon-border self-stretch sm:self-start lg:self-auto">
            <button
              type="button"
              onClick={() => onTabChange('tech')}
              aria-pressed={techTabActive}
              className={`flex-1 lg:flex-none justify-center whitespace-nowrap px-2 sm:px-3 py-1.5 text-[9px] sm:text-[10px] uppercase tracking-wider font-bold flex items-center gap-1.5 bezier-fast ${
                techTabActive
                  ? 'bg-flight-amber text-black border border-flight-amber'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-carbon-container border border-transparent'
              }`}
            >
              <span className="material-symbols-outlined text-sm">science</span>
              TECH TREE<span className="hidden sm:inline"> // POHON RISET</span>
            </button>
            <button
              type="button"
              onClick={() => onTabChange('hangar')}
              aria-pressed={!techTabActive}
              className={`flex-1 lg:flex-none justify-center whitespace-nowrap px-2 sm:px-3 py-1.5 text-[9px] sm:text-[10px] uppercase tracking-wider font-bold flex items-center gap-1.5 bezier-fast ${
                !techTabActive
                  ? 'bg-flight-amber text-black border border-flight-amber'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-carbon-container border border-transparent'
              }`}
            >
              <span className="material-symbols-outlined text-sm">precision_manufacturing</span>
              HANGAR<span className="hidden sm:inline"> // PERAKITAN BAY</span>
            </button>
          </div>
        </div>

        <div className="border-t border-carbon-border bg-carbon-container px-4 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[10px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-flight-amber uppercase tracking-wider font-bold">ALOKASI AKTIF:</span>
            <span className="bg-carbon-bg border border-carbon-border px-1.5 py-0.5 text-neutral-200">
              {ap} / {MAX_AP} AP TERSEDIA
            </span>
            <span className="text-neutral-600">//</span>
            <span className="bg-carbon-bg border border-carbon-border px-1.5 py-0.5 text-telemetry-cyan">
              KAS NEGARA: {budget} U [{budgetLabel}]
            </span>
            <span className="text-neutral-600">//</span>
            <span className="bg-carbon-bg border border-carbon-border px-1.5 py-0.5 text-phosphor-teal">
              TECH BONUS: +floor({rp}/20) = +{techBonus}% RP ACCEL
            </span>
          </div>
          <div className="text-neutral-500 uppercase tracking-widest hidden md:inline">
            STABILISASI DESAIN: <span className="text-flight-amber font-bold">{siLabel}-4</span>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <section
          className={`lg:col-span-7 flex flex-col gap-4 bezier-fast ${
            techTabActive ? '' : 'hidden lg:flex lg:opacity-40'
          }`}
        >
          <div className="bg-carbon-container border border-carbon-border px-3 py-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="bg-telemetry-cyan text-black px-1.5 py-0.5 text-[9px] font-bold shrink-0">MATRIKS-RD</span>
              <h2 className="font-headline font-bold text-[11px] sm:text-sm uppercase tracking-wide text-neutral-100 leading-snug">
                POHON TEKNOLOGI DIRGANTARA (1969 CYCLE)
              </h2>
            </div>
            <div className="text-[9px] text-neutral-500 uppercase tracking-wider whitespace-nowrap hidden sm:block">
              SKEMA CABANG: {techGroups.length} TIER FLIGHT-QUAL
            </div>
          </div>

          <div className="relative bg-carbon-bg border border-carbon-border p-3 sm:p-4 overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-carbon-border pb-2 mb-4 text-[9px] text-neutral-500 uppercase tracking-wider">
              <span className="text-phosphor-teal">{researchCount} TUNTAS</span>
              <span className="text-neutral-600">//</span>
              <span className="text-flight-amber">{inProgressCount} DITELITI</span>
              <span className="text-neutral-600">//</span>
              <span className="text-telemetry-cyan">{qualifiedCount} SIAP DITELITI</span>
              <span className="text-neutral-600">//</span>
              <span>{techRows.length} NODE TERDAFTAR</span>
            </div>

            {techLoading ? (
              <div className="py-10 text-center text-[11px] text-neutral-500">
                // SINKRONISASI MATRIKS RISET<span className="afm-cursor ml-2" />
              </div>
            ) : techError ? (
              <div className="border border-alert-red/40 bg-alert-red/5 p-4 text-[11px] text-alert-red">
                <p>&gt; MATRIKS RISET OFFLINE: {toUpper(techError)}</p>
                <button
                  type="button"
                  onClick={loadTechnologies}
                  className="mt-3 border border-alert-red/50 text-alert-red hover:bg-alert-red/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bezier-fast"
                >
                  RETRY MATRIX
                </button>
              </div>
            ) : techRows.length === 0 ? (
              <div className="border border-dashed border-carbon-border p-6 text-center text-[11px] text-neutral-500">
                // TIDAK ADA NODE TEKNOLOGI DI DATABASE
                <br />
                // JALANKAN SEED CATALOG SIKLUS 14 UNTUK MENGISI POHON RISET
                <button
                  type="button"
                  onClick={loadTechnologies}
                  className="mt-3 block mx-auto border border-carbon-border text-neutral-300 hover:text-neutral-200 hover:bg-carbon-container px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bezier-fast"
                >
                  REFRESH CATALOG
                </button>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-[9px] top-2 bottom-2 w-px bg-carbon-border-light hidden sm:block" aria-hidden="true" />
                <div className="space-y-5">
                  {techGroups.map((group) => {
                    const groupCompleted = group.rows.filter((row) => row.status === 'completed').length
                    return (
                      <section key={group.key} className="relative sm:pl-7">
                        <span className="absolute left-0 top-0.5 hidden sm:flex h-[19px] w-[19px] items-center justify-center bg-carbon-bg border border-carbon-border-light text-[8px] font-bold text-neutral-400">
                          {group.key === 3 ? '3-4' : pad(group.key)}
                        </span>
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span
                            className={`px-2 py-0.5 text-[9px] font-bold uppercase border ${
                              group.key === 2
                                ? 'bg-flight-amber/10 text-flight-amber border-flight-amber/40'
                                : 'bg-carbon-container text-neutral-400 border-carbon-border'
                            }`}
                          >
                            {group.badge}
                          </span>
                          <span className="text-[10px] uppercase tracking-wider text-neutral-300">{group.label}</span>
                          <span className="text-[9px] text-neutral-600 ml-auto">
                            {groupCompleted}/{group.rows.length} TUNTAS
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {group.rows.map((row) => {
                            const { tech, nodeCode, status, prerequisites, event } = row
                            const state = STATUS[status]
                            const affordable =
                              ap >= num(tech.research_cost_ap) && budget >= num(tech.research_cost_budget)
                            const description =
                              TECH_DESCRIPTION[String(tech.name || '').toLowerCase()] ||
                              `Node riset ${tech.era || 'Siklus 14'} dengan durasi ${num(tech.duration_days)} hari.`
                            const effect = TECH_EFFECT[String(tech.name || '').toLowerCase()]
                            const durationMs = Math.max(1, num(tech.duration_days)) * 86400000
                            const progress =
                              status === 'in_progress' && event
                                ? clamp(
                                    Math.round(
                                      ((Date.now() - new Date(event.log.created_at || 0).getTime()) / durationMs) *
                                        100,
                                    ),
                                  )
                                : 0
                            const finishLabel =
                              status === 'in_progress' && event
                                ? formatDate(new Date(event.log.created_at || 0).getTime() + durationMs)
                                : '—'

                            return (
                              <article
                                key={tech.id || nodeCode}
                                className={`border p-3 flex flex-col justify-between bezier-fast hover:bg-carbon-subtle ${state.card}`}
                              >
                                <div>
                                  <div className="flex items-center justify-between gap-2 mb-1.5">
                                    <span
                                      className={`text-[9px] font-bold uppercase flex items-center gap-1.5 ${state.tone}`}
                                    >
                                      <span className={`w-1.5 h-1.5 shrink-0 ${state.dot}`} />
                                      {state.label}
                                    </span>
                                    <span className="text-[9px] text-neutral-500 whitespace-nowrap">{nodeCode}</span>
                                  </div>
                                  <h3
                                    className={`font-headline font-bold text-[11px] sm:text-xs uppercase leading-snug ${
                                      status === 'locked' ? 'text-neutral-500' : 'text-neutral-100'
                                    }`}
                                  >
                                    {toUpper(tech.name)}
                                  </h3>
                                  <p
                                    className={`text-[10px] mt-1 leading-snug ${
                                      status === 'locked' ? 'text-neutral-600' : 'text-neutral-500'
                                    }`}
                                  >
                                    {description}
                                  </p>

                                  {status === 'completed' && effect && (
                                    <div className="mt-3 bg-carbon-bg border border-carbon-border px-2 py-1 flex items-center justify-between gap-2 text-[9px]">
                                      <span className="text-neutral-500">EFEK BONUS:</span>
                                      <span className="text-phosphor-teal font-bold text-right">{effect}</span>
                                    </div>
                                  )}

                                  {status === 'in_progress' && (
                                    <div className="mt-3 border border-carbon-border bg-carbon-bg p-2">
                                      <div className="flex justify-between text-[9px] mb-1">
                                        <span className="text-neutral-500">
                                          PROGRES RISET ({num(tech.duration_days)} HARI)
                                        </span>
                                        <span className="text-flight-amber font-bold">{progress}%</span>
                                      </div>
                                      <div className="w-full bg-carbon-container border border-carbon-border h-2 overflow-hidden">
                                        <div
                                          className="bg-flight-amber h-full transition-all duration-500"
                                          style={{ width: `${progress}%` }}
                                        />
                                      </div>
                                      <div className="flex justify-between text-[9px] text-neutral-500 mt-1.5 gap-2">
                                        <span>ESTIMASI SELESAI: {finishLabel}</span>
                                        <span className="text-telemetry-cyan font-semibold whitespace-nowrap">
                                          BIAYA: {num(tech.research_cost_ap)} AP // {num(tech.research_cost_budget)} U
                                        </span>
                                      </div>
                                      <div className="mt-2 border-t border-carbon-border pt-1.5 text-[9px] text-flight-amber uppercase tracking-wider">
                                        // AGM QUEUE: MENUNGGU VERIFIKASI SIKLUS
                                      </div>
                                    </div>
                                  )}

                                  {status === 'qualified' && (
                                    <>
                                      {prerequisites.length > 0 && (
                                        <div className="mt-2 text-[9px] text-neutral-500">
                                          PRASYARAT:{' '}
                                          <span className="text-neutral-300">{prerequisites.join(' // ')}</span>
                                        </div>
                                      )}
                                      <div className="mt-2 bg-carbon-bg border border-carbon-border px-2 py-1 flex items-center justify-between gap-2 text-[9px]">
                                        <span className="text-neutral-500">BIAYA RISET:</span>
                                        <span
                                          className={affordable ? 'text-neutral-100 font-bold' : 'text-alert-red font-bold'}
                                        >
                                          {num(tech.research_cost_ap)} AP // {num(tech.research_cost_budget)} U
                                        </span>
                                      </div>
                                      {effect && (
                                        <div className="mt-1 text-[9px] text-phosphor-teal/80">EFEK: {effect}</div>
                                      )}
                                    </>
                                  )}

                                  {status === 'locked' && (
                                    <div className="mt-3 bg-carbon-bg border border-carbon-border px-2 py-1 text-[9px] text-neutral-500">
                                      PRASYARAT:{' '}
                                      <span className="text-alert-red font-bold">
                                        {prerequisites.length > 0 ? prerequisites.join(' // ') : 'NODE INDUK BELUM TUNTAS'}
                                      </span>
                                    </div>
                                  )}
                                </div>

                                {status === 'qualified' && (
                                  <div className="mt-3">
                                    <button
                                      type="button"
                                      onClick={() => startResearch(tech)}
                                      disabled={Boolean(researchBusy) || !affordable}
                                      className={`w-full py-2 border text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 bezier-fast ${
                                        affordable
                                          ? 'bg-telemetry-cyan text-black border-telemetry-cyan hover:bg-telemetry-cyan/80'
                                          : 'bg-carbon-container text-neutral-500 border-carbon-border cursor-not-allowed'
                                      }`}
                                    >
                                      <span className="material-symbols-outlined text-sm">science</span>
                                      {researchBusy === tech.id
                                        ? 'MENGIRIM DIRECTIVE...'
                                        : researchBusy
                                          ? 'AGM QUEUE BUSY'
                                          : affordable
                                            ? 'MULAI RISET // POST API/START'
                                            : 'SALDO TIDAK CUKUP'}
                                    </button>
                                  </div>
                                )}
                              </article>
                            )
                          })}
                        </div>
                      </section>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        <aside
          className={`lg:col-span-5 flex flex-col gap-4 bezier-fast ${
            techTabActive ? 'hidden lg:flex lg:opacity-40' : ''
          }`}
        >
          <div className="bg-carbon-container border border-carbon-border px-3 py-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="bg-flight-amber text-black px-1.5 py-0.5 text-[9px] font-bold shrink-0">BAY-02</span>
              <h2 className="font-headline font-bold text-xs sm:text-sm uppercase tracking-wide text-neutral-100 truncate">
                FABRIKASI &amp; INTEGRASI KENDARAAN
              </h2>
            </div>
            <span className="material-symbols-outlined text-flight-amber text-[18px]">rocket_launch</span>
          </div>

          <div className="bg-carbon-surface border border-carbon-border flex flex-col">
            <div className="px-3 py-2 border-b border-carbon-border flex items-center justify-between gap-2">
              <span className="text-[9px] uppercase tracking-wider text-flight-amber font-bold truncate">
                BLUEPRINT AKTIF: {VEHICLE_LABEL[selectedType]} /{' '}
                {primaryVehicle && primaryVehicle.type === selectedType
                  ? toUpper(primaryVehicle.name)
                  : 'DESAIN REFERENSI'}
              </span>
              <span className="bg-carbon-container border border-carbon-border px-1.5 py-0.5 text-[9px] text-phosphor-teal shrink-0">
                CAL-SPEC 1969
              </span>
            </div>

            <div className="bg-carbon-bg blueprint-grid relative overflow-hidden flex flex-col items-center justify-center min-h-[220px] px-3 pt-6 pb-2">
              <div className="absolute top-2 left-2 text-[8px] text-neutral-500 uppercase tracking-wider">
                SCHEMATIC // BAY-02
              </div>
              <div className="absolute top-2 right-2 text-[8px] text-neutral-500 uppercase tracking-wider">
                {VEHICLE_LABEL[selectedType]} // MK-1969
              </div>

              <svg viewBox="0 0 340 180" className="w-full h-44 max-w-[340px]" fill="none" aria-hidden="true">
                <rect x="155" y="10" width="30" height="24" rx="12" fill="#00E5FF" fillOpacity="0.14" stroke="#00E5FF" strokeWidth="1.2" />
                <rect x="152" y="34" width="36" height="30" fill="#BEC6E0" fillOpacity="0.12" stroke="#BEC6E0" strokeWidth="1.2" />
                <rect x="150" y="64" width="40" height="60" fill="#F5A623" fillOpacity="0.12" stroke="#F5A623" strokeWidth="1.2" />
                <path d="M 150 124 L 138 144 L 150 140 Z" fill="#F5A623" fillOpacity="0.45" stroke="#F5A623" strokeWidth="1" />
                <path d="M 190 124 L 202 144 L 190 140 Z" fill="#F5A623" fillOpacity="0.45" stroke="#F5A623" strokeWidth="1" />
                <rect x="160" y="124" width="20" height="12" fill="#F5A623" fillOpacity="0.8" />
                <path d="M 162 136 L 156 160 L 184 160 L 178 136 Z" fill="#F5A623" fillOpacity="0.2" stroke="#F5A623" strokeDasharray="2,2" strokeWidth="1" />

                <path d="M 185 22 L 230 22 L 245 16" stroke="#00E5FF" strokeWidth="1" />
                <text x="250" y="18" fill="#E2E8F0" fontFamily="JetBrains Mono, monospace" fontSize="8" fontWeight="bold">
                  MODUL AWAK MK-II
                </text>
                <path d="M 152 48 L 105 48 L 90 40" stroke="#00E5FF" strokeWidth="1" />
                <text x="5" y="42" fill="#BEC6E0" fontFamily="JetBrains Mono, monospace" fontSize="8">
                  IBM 4Pi GUIDANCE
                </text>
                <path d="M 190 90 L 235 90 L 250 82" stroke="#F5A623" strokeWidth="1" />
                <text x="255" y="85" fill="#F5A623" fontFamily="JetBrains Mono, monospace" fontSize="8" fontWeight="bold">
                  TAHAP-1 LOX ({blueprintReliability}% REL)
                </text>
                <path d="M 150 110 L 95 110 L 80 120" stroke="#2DD4BF" strokeWidth="1" />
                <text x="10" y="124" fill="#2DD4BF" fontFamily="JetBrains Mono, monospace" fontSize="8">
                  INTERSTAGE RING
                </text>
                <text x="12" y="172" fill="#4B5563" fontFamily="JetBrains Mono, monospace" fontSize="7">
                  SCALE 1:120 // AFM ENGINEERING
                </text>
              </svg>

              <div className="w-full flex items-center justify-between gap-2 text-[9px] text-neutral-400 bg-carbon-container border border-carbon-border px-2 py-1 mt-1">
                <span>MASSA: {selectedSpec.mass}</span>
                <span>DORONG: {selectedSpec.thrust}</span>
                <span className="text-phosphor-teal font-bold">DELTA-V: {selectedSpec.deltaV}</span>
              </div>
            </div>

            <div className="p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] uppercase tracking-wider text-neutral-400 font-bold">
                  ANTREAN HANGAR &amp; WAHANA AKTIF
                </span>
                <span className="text-[9px] text-flight-amber whitespace-nowrap">{vehicles.length} TERDAFTAR</span>
              </div>

              <div className="space-y-1.5 max-h-[190px] overflow-y-auto custom-scroll">
                {vehicles.length === 0 ? (
                  <div className="border border-dashed border-carbon-border px-3 py-4 text-center text-[10px] text-neutral-500">
                    HANGAR KOSONG // FABRIKASI WAHANA PERTAMA
                  </div>
                ) : (
                  vehicles.slice(0, 4).map((vehicle) => {
                    const testing = toUpper(vehicle.status || 'testing') === 'TESTING'
                    return (
                      <div
                        key={vehicle.id}
                        className="bg-carbon-container border border-carbon-border px-2.5 py-2 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 shrink-0 ${testing ? 'bg-flight-amber' : 'bg-phosphor-teal'}`} />
                            <span className="text-[10px] font-headline font-bold text-neutral-100 uppercase truncate">
                              {toUpper(vehicle.name)}
                            </span>
                          </div>
                          <span className="text-[9px] text-neutral-500 uppercase">
                            {VEHICLE_LABEL[vehicle.type] || titleCase(vehicle.type)} //{' '}
                            {num(vehicle.total_launches)} LAUNCH
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <span
                            className={`block text-[9px] font-bold px-1.5 py-0.5 border ${
                              testing
                                ? 'text-flight-amber border-flight-amber/30 bg-flight-amber/5'
                                : 'text-phosphor-teal border-phosphor-teal/30 bg-phosphor-teal/5'
                            }`}
                          >
                            {toUpper(vehicle.status || 'TESTING')} ({Math.round(num(vehicle.reliability))}%)
                          </span>
                          <span className="text-[8px] text-neutral-600">{formatTime(vehicle.created_at)}</span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              <div className="border-t border-carbon-border pt-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] uppercase font-bold text-neutral-200">PILIH KLASIFIKASI WAHANA BARU</span>
                  <span className="text-[9px] text-telemetry-cyan">AGM RULE 2.4</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {VEHICLE_TYPES.map((type) => {
                    const cost = VEHICLE_COST[type]
                    const active = type === selectedType
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setSelectedType(type)}
                        aria-pressed={active}
                        className={`px-2 py-1.5 text-left border uppercase bezier-fast ${
                          active
                            ? 'bg-carbon-subtle border-flight-amber'
                            : 'bg-carbon-bg border-carbon-border hover:bg-carbon-container'
                        }`}
                      >
                        <span className={`block text-[9px] font-bold ${active ? 'text-flight-amber' : 'text-neutral-200'}`}>
                          {VEHICLE_LABEL[type]}
                        </span>
                        <span className="block text-[8px] text-flight-amber">
                          {cost.ap} AP // {cost.budget} U
                        </span>
                      </button>
                    )
                  })}
                </div>

                <label className="flex flex-col gap-1 text-[9px] uppercase text-neutral-500">
                  DESIGNASI WAHANA
                  <span className="flex items-center border border-carbon-border bg-carbon-bg px-2 py-1.5">
                    <span className="text-telemetry-cyan font-bold mr-1.5">{'>'}</span>
                    <input
                      value={vehicleName}
                      onChange={(event) => setVehicleName(event.target.value)}
                      placeholder={`${autoName}-XXXXX`}
                      maxLength={40}
                      spellCheck={false}
                      autoComplete="off"
                      className="w-full min-w-0 bg-transparent border-0 text-[10px] text-neutral-100 placeholder:text-neutral-600 px-0 py-0"
                    />
                    <span className="afm-cursor ml-1" />
                  </span>
                </label>

                <div className="bg-carbon-bg border border-carbon-border px-2.5 py-2 flex flex-col gap-1 text-[9px]">
                  <div className="flex justify-between items-center gap-2 text-neutral-300">
                    <span>ESTIMASI KEANDALAN AWAL:</span>
                    <span className="text-phosphor-teal font-bold">70% [STATUS: TESTING]</span>
                  </div>
                  <div className="flex justify-between items-center gap-2 text-neutral-500">
                    <span>BONUS FORMULA DIREKTORAT:</span>
                    <span className="text-flight-amber font-bold">
                      +{techBonus}% (floor({rp} RP / 20))
                    </span>
                  </div>
                  <div className="flex justify-between items-center gap-2 text-neutral-500">
                    <span>KAPASITAS HANGAR BAY:</span>
                    <span className={vehicles.length >= HANGAR_SLOTS ? 'text-alert-red font-bold' : 'text-neutral-200'}>
                      {vehicles.length} / {HANGAR_SLOTS} SLOT TERISI
                    </span>
                  </div>
                  <div className="flex justify-between items-center gap-2 text-neutral-500 border-t border-carbon-border pt-1">
                    <span>SISA SALDO:</span>
                    <span className={canAfford ? 'text-phosphor-teal font-bold' : 'text-alert-red font-bold'}>
                      AP {ap} // {budget} U
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={fabricate}
                  disabled={productionBusy || !canAfford}
                  className={`w-full py-3 border text-[11px] font-headline font-bold uppercase tracking-wider flex items-center justify-center gap-2 bezier-fast ${
                    productionBusy
                      ? 'bg-phosphor-teal text-black border-phosphor-teal'
                      : canAfford
                        ? 'bg-flight-amber text-black border-flight-amber hover:bg-flight-amber-dim'
                        : 'bg-carbon-container text-neutral-500 border-carbon-border cursor-not-allowed'
                  }`}
                >
                  <span className="material-symbols-outlined text-base">precision_manufacturing</span>
                  {productionBusy
                    ? 'MEMPROSES INTEGRASI... [AGM DEDUKSI SELESAI]'
                    : `FABRIKASI ${VEHICLE_LABEL[selectedType]} // DEDUKSI ${selectedCost.ap} AP + ${selectedCost.budget} U`}
                </button>
                {!canAfford && (
                  <p className="text-[9px] text-alert-red text-center uppercase tracking-wider">
                    SALDO TIDAK CUKUP UNTUK KLASIFIKASI INI
                  </p>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>

      <section className="mt-4 border border-carbon-border bg-carbon-surface">
        <div className="bg-carbon-container border-b border-carbon-border px-3 py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-phosphor-teal" />
            <span className="font-headline font-bold text-[10px] sm:text-xs text-neutral-200 uppercase tracking-widest">
              AGM REAL-TIME AUDIT LOG // KONSISTENSI FORMULA SIKLUS {CYCLE}
            </span>
          </div>
          <span className="text-[9px] text-neutral-500 font-mono">
            NODE: {toUpper(String(agencyName || 'VALORIA').split(' ')[0])}-AGM-RND-1969
          </span>
        </div>

        <div className="p-3 space-y-1.5 max-h-[180px] overflow-y-auto custom-scroll">
          {logs.length === 0 ? (
            <div className="text-[10px] text-neutral-500">
              // BELUM ADA AUDIT EVENT
              <br />
              // MULAI RISET ATAU FABRIKASI WAHANA UNTUK MENGISI STREAM
            </div>
          ) : (
            logs.slice(0, 8).map((log) => (
              <div key={log.id} className="text-[10px] text-neutral-400 leading-snug">
                <span className={`${eventTone(log.event_type)} font-bold font-mono`}>
                  [{formatTime(log.created_at)}] {toUpper(log.event_type || 'EVENT')}:
                </span>{' '}
                {log.description}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-carbon-border px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[9px] text-neutral-500">
          <span>AGM RULE ENGINE v1.4 // DETERMINISTIC SIM</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onExit}
              className="border border-carbon-border text-neutral-400 hover:text-neutral-200 hover:bg-carbon-container px-2 py-1 uppercase tracking-wider bezier-fast"
            >
              MISSION CONTROL
            </button>
            <span className="text-phosphor-teal">ONLINE</span>
          </div>
        </div>
      </section>
    </div>
  )
}
