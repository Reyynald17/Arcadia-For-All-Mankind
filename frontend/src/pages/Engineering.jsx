import { useCallback, useEffect, useMemo, useState } from 'react'

const MAX_AP = 50

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
  'sounding-rocket': '12.4 T // 240 kN // 2,100 m/s',
  'orbital-rocket': '142.8 T // 1,850 kN // 9,450 m/s',
  satellite: '1.8 T // — // —',
  capsule: '5.2 T // — // 3,600 m/s',
  probe: '2.6 T // — // 4,200 m/s',
  lander: '18.7 T // — // 5,800 m/s',
}

const TIER_LABEL = {
  1: 'SUB-ORBITAL & ATMOSFERIK',
  2: 'ORBIT BUMI & PENERBANGAN BERAWAK',
  3: 'TRANS-LUNAR & HABITASI',
}

const STATUS = {
  completed: { label: 'TUNTAS', tone: 'text-neutral-400' },
  in_progress: { label: 'DITELITI', tone: 'text-flight-amber' },
  qualified: { label: 'SIAP', tone: 'text-neutral-300' },
  locked: { label: 'TERKUNCI', tone: 'text-neutral-400' },
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
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}Z`
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${pad(date.getUTCDate())} ${date.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }).toUpperCase()}`
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
    const completed = type.includes('COMPLETED')
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

export default function Engineering({
  agencyId,
  agencyName,
  ap,
  budget,
  rp,
  vehicles,
  logs,
  tab,
  onTabChange,
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
        [...researchEvents.entries()].filter(([, event]) => event.completed).map(([name]) => name),
      ),
    [researchEvents],
  )

  const techRows = useMemo(
    () =>
      technologies.map((tech) => {
        const matchedTier = String(tech.era || '').match(/\d+/)
        const tier = matchedTier ? Number(matchedTier[0]) : 1
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
          prerequisites,
          event,
          status,
        }
      }),
    [completedTechs, researchEvents, technologies],
  )

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
        badge: key === 3 ? 'TIER 03-04' : `TIER ${pad(key)}`,
        label: TIER_LABEL[key] || `TIER ${pad(key)}`,
        rows,
      }))
  }, [techRows])

  const completedCount = techRows.filter((row) => row.status === 'completed').length
  const inProgressCount = techRows.filter((row) => row.status === 'in_progress').length

  const selectedCost = VEHICLE_COST[selectedType]
  const canAfford = ap >= selectedCost.ap && budget >= selectedCost.budget
  const autoName = `AUTO-${VEHICLE_LABEL[selectedType].replace(/\s+/g, '-')}`
  const primaryVehicle = vehicles[0] || null
  const blueprintReliability =
    primaryVehicle && primaryVehicle.type === selectedType ? Math.round(num(primaryVehicle.reliability)) : 70

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
      notify(`RISET DIMULAI: ${toUpper(tech.name)}`)
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
      notify(`FABRIKASI SELESAI: ${toUpper(name)}`)
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

  const tabButton = (active, onClick, icon, label) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 whitespace-nowrap px-1 pb-1.5 text-[10px] uppercase tracking-wider border-b-2 bezier-fast ${
        active
          ? 'border-flight-amber text-flight-amber font-bold'
          : 'border-transparent text-neutral-400 hover:text-neutral-100'
      }`}
    >
      <span className="material-symbols-outlined text-sm">{icon}</span>
      {label}
    </button>
  )

  return (
    <div className="space-y-4">
      <section className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 border-b border-carbon-border pb-0">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-widest text-neutral-400">
            Divisi Rekayasa // {toUpper(agencyName)}
          </div>
          <h1 className="font-headline font-bold text-base uppercase text-neutral-100 tracking-tight">
            Lab Riset &amp; Hangar
          </h1>
        </div>
        <div className="flex items-center gap-4 sm:self-end">
          {tabButton(techTabActive, () => onTabChange('tech'), 'science', 'TECH TREE')}
          {tabButton(!techTabActive, () => onTabChange('hangar'), 'precision_manufacturing', 'HANGAR')}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4">
        {techTabActive && (
        <section className="bg-carbon-surface border border-carbon-border flex flex-col">
          <PanelHead
            title="Pohon Teknologi"
            right={`${completedCount}/${techRows.length} TUNTAS // ${inProgressCount} DITELITI`}
          />

          <div className="flex-1 px-3 py-2">
            {techLoading ? (
              <div className="py-10 text-center text-[11px] text-neutral-400">
                // SINKRONISASI MATRIKS<span className="afm-cursor ml-2" />
              </div>
            ) : techError ? (
              <div className="py-3 text-[11px] text-alert-red">
                <p>&gt; MATRIKS OFFLINE: {toUpper(techError)}</p>
                <button
                  type="button"
                  onClick={loadTechnologies}
                  className="mt-2 border border-alert-red/50 hover:bg-alert-red/10 px-2 py-1 text-[10px] font-bold uppercase"
                >
                  Retry
                </button>
              </div>
            ) : techRows.length === 0 ? (
              <div className="py-8 text-center text-[10px] text-neutral-400 uppercase">
                Tidak ada node teknologi
                <button
                  type="button"
                  onClick={loadTechnologies}
                  className="mt-2 block mx-auto border border-carbon-border hover:border-carbon-border-light px-2 py-1 font-bold text-neutral-200"
                >
                  Refresh
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                {techGroups.map((group) => (
                  <section key={group.key}>
                    <div className="flex items-baseline gap-2 border-b border-carbon-border pb-1.5">
                      <span className="text-[9px] font-bold text-neutral-200 tracking-wider">{group.badge}</span>
                      <span className="text-[9px] uppercase tracking-wider text-neutral-400 truncate">{group.label}</span>
                      <span className="ml-auto text-[9px] text-neutral-400 whitespace-nowrap">
                        {group.rows.filter((row) => row.status === 'completed').length}/{group.rows.length}
                      </span>
                    </div>

                    <div className="divide-y divide-carbon-border">
                      {group.rows.map((row) => {
                        const { tech, status, prerequisites, event } = row
                        const state = STATUS[status]
                        const affordable =
                          ap >= num(tech.research_cost_ap) && budget >= num(tech.research_cost_budget)
                        const durationMs = Math.max(1, num(tech.duration_days)) * 86400000
                        const progress =
                          status === 'in_progress' && event
                            ? clamp(
                                Math.round(
                                  ((Date.now() - new Date(event.log.created_at || 0).getTime()) / durationMs) * 100,
                                ),
                              )
                            : 0
                        const finishLabel =
                          status === 'in_progress' && event
                            ? formatDate(new Date(event.log.created_at || 0).getTime() + durationMs)
                            : null

                        return (
                          <article key={tech.id || tech.name} className="py-2 flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`text-[9px] font-bold uppercase tracking-wider ${state.tone}`}>
                                  {state.label}
                                </span>
                              </div>
                              <h3
                                className={`font-headline font-bold text-[11px] uppercase leading-snug mt-0.5 ${
                                  status === 'locked' ? 'text-neutral-400' : 'text-neutral-100'
                                }`}
                              >
                                {toUpper(tech.name)}
                              </h3>

                              {status === 'locked' ? (
                                <p className="text-[9px] text-neutral-400 mt-0.5 truncate">
                                  Butuh: {prerequisites.length ? prerequisites.join(' // ') : 'node induk'}
                                </p>
                              ) : (
                                <p className="text-[9px] text-neutral-400 mt-0.5">
                                  {num(tech.research_cost_ap)} AP // {num(tech.research_cost_budget)} U //{' '}
                                  {num(tech.duration_days)} HARI
                                </p>
                              )}

                              {status === 'in_progress' && (
                                <div className="mt-1.5">
                                  <div className="h-1 bg-carbon-bg">
                                    <div className="h-full bg-flight-amber" style={{ width: `${progress}%` }} />
                                  </div>
                                  <div className="flex justify-between text-[9px] text-neutral-400 mt-0.5">
                                    <span>{progress}%</span>
                                    <span>SELESAI ~{finishLabel}</span>
                                  </div>
                                </div>
                              )}
                            </div>

                            {status === 'qualified' && (
                              <button
                                type="button"
                                onClick={() => startResearch(tech)}
                                disabled={Boolean(researchBusy) || !affordable}
                                className={`shrink-0 px-2.5 py-1.5 border text-[9px] font-bold uppercase tracking-wider bezier-fast ${
                                  affordable
                                    ? 'border-flight-amber/50 text-flight-amber hover:bg-flight-amber/10'
                                    : 'border-carbon-border text-neutral-400 cursor-not-allowed'
                                }`}
                              >
                                {researchBusy === tech.id ? '...' : researchBusy ? 'BUSY' : 'Riset'}
                              </button>
                            )}
                          </article>
                        )
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </section>
        )}

        {!techTabActive && (
        <aside className="bg-carbon-surface border border-carbon-border flex flex-col">
          <PanelHead title="Fabrikasi Wahana" right={`${vehicles.length} UNIT`} />

          <div className="p-3 grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-4">
            <div className="space-y-3 min-w-0">
            <div className="border border-carbon-border bg-carbon-bg">
              <svg viewBox="0 0 200 120" className="w-full h-28" fill="none" aria-hidden="true">
                <rect x="88" y="6" width="24" height="18" rx="9" fill="#9CA3AF" fillOpacity="0.08" stroke="#9CA3AF" strokeWidth="1" />
                <rect x="86" y="24" width="28" height="22" fill="#9CA3AF" fillOpacity="0.06" stroke="#9CA3AF" strokeWidth="1" />
                <rect x="84" y="46" width="32" height="40" fill="#F5A623" fillOpacity="0.06" stroke="#F5A623" strokeWidth="1" />
                <path d="M 84 86 L 74 100 L 84 96 Z" fill="#F5A623" fillOpacity="0.25" stroke="#F5A623" strokeWidth="1" />
                <path d="M 116 86 L 126 100 L 116 96 Z" fill="#F5A623" fillOpacity="0.25" stroke="#F5A623" strokeWidth="1" />
                <path d="M 92 96 L 88 112 L 112 112 L 108 96 Z" fill="#F5A623" fillOpacity="0.1" stroke="#F5A623" strokeDasharray="2,2" strokeWidth="1" />
                <text x="100" y="118" textAnchor="middle" fill="#9CA3AF" fontFamily="JetBrains Mono, monospace" fontSize="6">
                  {VEHICLE_LABEL[selectedType]} // REL {blueprintReliability}%
                </text>
              </svg>
            </div>

            <div className="flex items-center justify-between gap-2 text-[9px] text-neutral-400 border-b border-carbon-border pb-1.5">
              <span className="truncate">{VEHICLE_LABEL[selectedType]}</span>
              <span className="truncate text-right">{VEHICLE_SPEC[selectedType]}</span>
            </div>

            <div>
              <div className="text-[9px] uppercase tracking-wider text-neutral-400 mb-1">Antrean Hangar</div>
              {vehicles.length === 0 ? (
                <div className="py-3 text-center text-[10px] text-neutral-400 uppercase">
                  Kosong
                </div>
              ) : (
                <div className="max-h-[132px] overflow-y-auto custom-scroll divide-y divide-carbon-border">
                  {vehicles.slice(0, 4).map((vehicle) => (
                    <div
                      key={vehicle.id}
                      className="py-1.5 flex items-center justify-between gap-2"
                    >
                      <span className="text-[10px] font-bold text-neutral-100 uppercase truncate">
                        {toUpper(vehicle.name)}
                      </span>
                      <span className="text-[9px] text-neutral-400 whitespace-nowrap">
                        {Math.round(num(vehicle.reliability))}% // {formatTime(vehicle.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </div>

            <div className="space-y-3 min-w-0">
            <div>
              <div className="text-[9px] uppercase tracking-wider text-neutral-400 mb-1">Klasifikasi</div>
              <div className="grid grid-cols-2">
                {VEHICLE_TYPES.map((type) => {
                  const cost = VEHICLE_COST[type]
                  const active = type === selectedType
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setSelectedType(type)}
                      aria-pressed={active}
                      className={`flex items-baseline justify-between gap-2 py-1.5 pr-1 text-left uppercase border-b bezier-fast ${
                        active
                          ? 'border-flight-amber text-flight-amber'
                          : 'border-carbon-border text-neutral-300 hover:text-neutral-100'
                      }`}
                    >
                      <span className="text-[9px] font-bold truncate">{VEHICLE_LABEL[type]}</span>
                      <span className="text-[8px] text-neutral-400 whitespace-nowrap">
                        {cost.ap} AP // {cost.budget} U
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <label className="flex flex-col gap-1 text-[9px] uppercase text-neutral-400">
              Nama Wahana
              <input
                value={vehicleName}
                onChange={(event) => setVehicleName(event.target.value)}
                placeholder={`${autoName}-XXXXX`}
                maxLength={40}
                spellCheck={false}
                autoComplete="off"
                className="h-8 w-full bg-carbon-bg border border-carbon-border px-2 text-[10px] text-neutral-100 placeholder:text-neutral-400 focus:border-flight-amber"
              />
            </label>

            <button
              type="button"
              onClick={fabricate}
              disabled={productionBusy || !canAfford}
              className={`w-full py-2 border text-[10px] font-headline font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 bezier-fast ${
                productionBusy
                  ? 'bg-flight-amber/20 text-flight-amber border-flight-amber/40 cursor-wait'
                  : canAfford
                    ? 'bg-flight-amber text-black border-flight-amber hover:bg-flight-amber-dim'
                    : 'bg-carbon-container text-neutral-400 border-carbon-border cursor-not-allowed'
              }`}
            >
              <span className="material-symbols-outlined text-sm">precision_manufacturing</span>
              {productionBusy
                ? 'Integrasi...'
                : `Fabrikasi // ${selectedCost.ap} AP + ${selectedCost.budget} U`}
            </button>

            <div className="flex items-center justify-between text-[9px] text-neutral-400 border-t border-carbon-border pt-1.5">
              <span>BONUS RP +{Math.floor(rp / 20)}%</span>
              <span>AP {ap}/{MAX_AP} // {budget} U</span>
            </div>
            </div>
          </div>
        </aside>
        )}
      </div>
    </div>
  )
}
