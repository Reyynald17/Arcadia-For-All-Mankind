import { useCallback, useEffect, useMemo, useState } from 'react'
import TechTree from '../components/TechTree'

const VEHICLE_TYPES = ['sounding-rocket', 'orbital-rocket', 'satellite', 'capsule', 'probe', 'lander']

const VEHICLE_LABEL = {
  'sounding-rocket': 'ROKET SONDA',
  'orbital-rocket': 'ROKET ORBITAL',
  satellite: 'SATELIT',
  capsule: 'KAPSUL',
  probe: 'PROBE',
  lander: 'LANDER',
}

const VEHICLE_COST_USD = {
  'sounding-rocket': 500000,
  'orbital-rocket': 2500000,
  satellite: 1200000,
  capsule: 3500000,
  probe: 1800000,
  lander: 5000000,
}

const VEHICLE_SPEC = {
  'sounding-rocket': '12.4 T // 240 kN // 2,100 m/s',
  'orbital-rocket': '142.8 T // 1,850 kN // 9,450 m/s',
  satellite: '1.8 T // — // —',
  capsule: '5.2 T // — // 3,600 m/s',
  probe: '2.6 T // — // 4,200 m/s',
  lander: '18.7 T // — // 5,800 m/s',
}

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
const pad = (value) => String(value).padStart(2, '0')
const toUpper = (value) => String(value ?? '').toUpperCase()

function formatUsd(value) {
  const amount = num(value)
  if (amount >= 1000000000) return `$${(amount / 1000000000).toFixed(2)}B`
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`
  if (amount >= 1000) return `$${Math.round(amount / 1000)}K`
  return `$${Math.round(amount)}`
}

function formatTime(value) {
  if (!value) return '--:--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--'
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}Z`
}

function vehicleStateLabel(vehicle) {
  if (vehicle.status === 'manufacturing') return 'PRODUCTION'
  if (vehicle.status === 'assigned') return 'ASSIGNED'
  return `${Math.round(num(vehicle.reliability))}%`
}

function techEmbargoed(tech, alignment, westernStanding, easternStanding) {
  const affinity = String(tech.alignment_affinity || '').toUpperCase()
  if (!tech.is_export_controlled || affinity === 'ANY' || affinity === String(alignment || '').toUpperCase()) {
    return false
  }
  const required = num(tech.spec?.embargo_risk?.min_standing_required ?? 70)
  const standing = affinity === 'WESTERN' ? num(westernStanding) : num(easternStanding)
  return standing < required
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
  alignment,
  westernStanding,
  easternStanding,
  sciencePoints,
  fundingUsd,
  rp,
  vehicles,
  tab,
  onTabChange,
  onRefresh,
  pushLine,
  notify,
  apiRequest,
}) {
  const [technologies, setTechnologies] = useState([])
  const [nodes, setNodes] = useState([])
  const [techLoading, setTechLoading] = useState(true)
  const [techError, setTechError] = useState('')
  const [selectedType, setSelectedType] = useState('orbital-rocket')
  const [vehicleName, setVehicleName] = useState('')
  const [researchBusy, setResearchBusy] = useState(null)
  const [staticFireBusy, setStaticFireBusy] = useState(null)
  const [productionBusy, setProductionBusy] = useState(false)

  const loadTechnologies = useCallback(async () => {
    if (!agencyId) return
    setTechLoading(true)
    setTechError('')
    try {
      const payload = await apiRequest(`/research/available/${agencyId}`)
      if (Array.isArray(payload)) {
        setTechnologies(payload)
        setNodes([])
      } else {
        setTechnologies(Array.isArray(payload?.technologies) ? payload.technologies : [])
        setNodes(Array.isArray(payload?.nodes) ? payload.nodes : [])
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

  const techById = useMemo(
    () => new Map(technologies.map((tech) => [tech.node_id, tech])),
    [technologies],
  )
  const nodeByNodeId = useMemo(
    () => new Map(nodes.map((node) => [node.node_id, node])),
    [nodes],
  )

  const techRows = useMemo(
    () => technologies.map((tech) => {
      const tier = num(tech.era_number) || Number(String(tech.era || '').match(/\d+/)?.[0]) || 1
      const prereqIds = Array.isArray(tech.prerequisite_node_ids)
        ? tech.prerequisite_node_ids.filter(Boolean)
        : []
      const prereqNames = prereqIds.map(
        (nodeId) => techById.get(nodeId)?.name || nodeId,
      )
      const prereqMet = prereqIds.every(
        (nodeId) => nodeByNodeId.get(nodeId)?.status === 'UNLOCKED',
      )
      const node = nodeByNodeId.get(tech.node_id) || null

      let status = 'qualified'
      if (node?.status === 'UNLOCKED') status = 'completed'
      else if (node?.status === 'RESEARCHING') status = 'in_progress'
      else if (
        node?.status === 'EMBARGOED'
        || techEmbargoed(tech, alignment, westernStanding, easternStanding)
      ) status = 'embargoed'
      else if (node?.status === 'LOCKED' || !prereqMet) status = 'locked'

      const modifier = tech.spec?.cost_modifiers?.[alignment] || {}
      const scienceMultiplier = num(modifier.science_mult) || 1
      const daysMultiplier = num(modifier.days_mult) || 1
      const scienceCost = Math.max(
        1,
        Math.round(num(tech.research_cost_science) * scienceMultiplier),
      )
      const fundingCost = num(tech.research_cost_funding)
      const baseDays = Math.round(num(tech.base_days) * daysMultiplier)

      return {
        tech,
        tier,
        prereqNames,
        node,
        status,
        scienceCost,
        fundingCost,
        baseDays,
      }
    }),
    [alignment, easternStanding, nodeByNodeId, techById, technologies, westernStanding],
  )

  const selectedCost = VEHICLE_COST_USD[selectedType]
  const canAfford = fundingUsd >= selectedCost
  const autoName = `AUTO-${VEHICLE_LABEL[selectedType].replace(/\s+/g, '-')}`
  const primaryVehicle =
    vehicles.find((vehicle) => !['manufacturing', 'assigned'].includes(vehicle.status)) || null
  const blueprintReliability =
    primaryVehicle && primaryVehicle.type === selectedType ? Math.round(num(primaryVehicle.reliability)) : 70

  const startResearch = async (row) => {
    if (!agencyId || researchBusy) return
    setResearchBusy(row.tech.node_id)
    try {
      const result = await apiRequest('/research/start', {
        method: 'POST',
        body: JSON.stringify({ agencyId, nodeId: row.tech.node_id }),
      })
      pushLine(
        'ok',
        `> RESEARCH STARTED: ${toUpper(result.technology || row.tech.name)} // ${result.durationGameDays ?? row.baseDays} HARI GAME`,
      )
      pushLine(
        'data',
        `> BIAYA: ${result.cost?.science_points ?? row.scienceCost} SP // ${formatUsd(result.cost?.funding_usd ?? row.fundingCost)} // SALDO ${result.newStats?.science_points} SP`,
      )
      notify(`RISET DIMULAI: ${toUpper(row.tech.name)}`)
      await Promise.all([onRefresh(), loadTechnologies()])
    } catch (err) {
      pushLine('error', `> RESEARCH ERROR: ${toUpper(err.message || 'UNKNOWN')}`)
      notify(`RISET GAGAL: ${toUpper(err.message || 'UNKNOWN')}`)
    } finally {
      setResearchBusy(null)
    }
  }

  const runStaticFire = async (row) => {
    if (!agencyId || staticFireBusy) return
    const testCost = num(row.tech.static_test_cost)
    if (fundingUsd < testCost) {
      notify(`UJI STATIS DITOLAK: BUTUH ${formatUsd(testCost)}`)
      return
    }
    setStaticFireBusy(row.tech.node_id)
    try {
      const result = await apiRequest('/research/static-fire', {
        method: 'POST',
        body: JSON.stringify({ agencyId, nodeId: row.tech.node_id }),
      })
      pushLine(
        'ok',
        `> STATIC FIRE SCHEDULED: ${toUpper(result.technology || row.tech.name)} // ${result.durationGameDays} HARI GAME`,
      )
      pushLine(
        'data',
        `> BURN ${result.burnSeconds}S // SELESAI ${formatTime(result.completesAt)} // BIAYA ${formatUsd(result.testCostUsd)}`,
      )
      notify(`UJI STATIS DIJADWALKAN: ${toUpper(row.tech.name)}`)
      await Promise.all([onRefresh(), loadTechnologies()])
    } catch (err) {
      pushLine('error', `> STATIC FIRE ERROR: ${toUpper(err.message || 'UNKNOWN')}`)
      notify(`UJI STATIS GAGAL: ${toUpper(err.message || 'UNKNOWN')}`)
    } finally {
      setStaticFireBusy(null)
    }
  }

  const fabricate = async () => {
    if (!agencyId || productionBusy) return
    if (!canAfford) {
      notify(`FABRIKASI DITOLAK: BUTUH ${formatUsd(selectedCost)}`)
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
        `> ASSEMBLY STARTED: ${toUpper(result.vehicle?.name || name)} // ${result.productionGameDays} HARI GAME`,
      )
      pushLine(
        'data',
        `> READY ${formatTime(result.productionCompletesAt)} // SALDO ${formatUsd(result.newStats?.funding_usd)}`,
      )
      notify(`FABRIKASI DIMULAI: ${toUpper(name)}`)
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
          <TechTree
            rows={techRows}
            loading={techLoading}
            error={techError}
            onRetry={loadTechnologies}
            researchBusy={researchBusy}
            staticFireBusy={staticFireBusy}
            sciencePoints={sciencePoints}
            fundingUsd={fundingUsd}
            onStartResearch={startResearch}
            onStaticFire={runStaticFire}
          />
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
                <rect x="84" y="46" width="32" height="40" fill="#D97706" fillOpacity="0.06" stroke="#D97706" strokeWidth="1" />
                <path d="M 84 86 L 74 100 L 84 96 Z" fill="#D97706" fillOpacity="0.25" stroke="#D97706" strokeWidth="1" />
                <path d="M 116 86 L 126 100 L 116 96 Z" fill="#D97706" fillOpacity="0.25" stroke="#D97706" strokeWidth="1" />
                <path d="M 92 96 L 88 112 L 112 112 L 108 96 Z" fill="#D97706" fillOpacity="0.1" stroke="#D97706" strokeDasharray="2,2" strokeWidth="1" />
                <text x="100" y="118" textAnchor="middle" fill="#9CA3AF" fontFamily="IBM Plex Mono, monospace" fontSize="6">
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
                        {vehicleStateLabel(vehicle)} // {formatTime(vehicle.created_at)}
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
                  const cost = VEHICLE_COST_USD[type]
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
                      <span className="text-[8px] text-neutral-400 whitespace-nowrap tabular-nums">
                        {formatUsd(cost)}
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
                : `Fabrikasi // ${formatUsd(selectedCost)}`}
            </button>

            <div className="flex items-center justify-between text-[9px] text-neutral-400 border-t border-carbon-border pt-1.5 tabular-nums">
              <span>BONUS RP +{Math.floor(rp / 20)}%</span>
              <span>{sciencePoints} SP // {formatUsd(fundingUsd)}</span>
            </div>
            </div>
          </div>
        </aside>
        )}
      </div>
    </div>
  )
}
