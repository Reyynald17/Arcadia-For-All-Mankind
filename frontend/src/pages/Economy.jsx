import { useCallback, useEffect, useMemo, useState } from 'react'

const MISSION_LABEL = {
  test: 'UJI TEKNIS',
  scientific: 'SAINTIFIK',
  manned: 'BERAWAK',
  colonial: 'KOLONIAL',
}

const MISSION_VEHICLE_TYPES = {
  test: ['sounding-rocket', 'orbital-rocket'],
  scientific: ['orbital-rocket', 'satellite', 'probe'],
  manned: ['capsule'],
  colonial: ['lander'],
}

const STATUS_TONE = {
  ACTIVE: 'text-flight-amber',
  COMPLETED: 'text-emerald-400',
  QUEUED: 'text-neutral-200',
  FAILED: 'text-alert-red',
  CANCELLED: 'text-neutral-500',
  AVAILABLE: 'text-neutral-300',
}

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
const toUpper = (value) => String(value ?? '').toUpperCase()

function formatUsd(value) {
  const amount = num(value)
  if (amount >= 1000000000) return `$${(amount / 1000000000).toFixed(2)}B`
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`
  if (amount >= 1000) return `$${Math.round(amount / 1000)}K`
  return `$${Math.round(amount)}`
}

function formatInt(value) {
  return Math.round(num(value)).toLocaleString('en-US')
}

function formatSignedUsd(value) {
  const amount = num(value)
  return `${amount >= 0 ? '+' : '-'}${formatUsd(Math.abs(amount))}`
}

function formatTime(value) {
  if (!value) return '--:--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--'
  return date.toISOString().replace('T', ' ').slice(0, 16) + 'Z'
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

function BudgetPanel({ budget }) {
  if (!budget) {
    return (
      <section className="bg-carbon-surface border border-carbon-border">
        <PanelHead title="Annual Operating Budget" right="NO DATA" />
        <div className="px-3 py-3 text-[10px] uppercase text-neutral-500">
          // Proyeksi budget belum tersedia
        </div>
      </section>
    )
  }

  const appropriation = budget.appropriation || {}
  const operating = budget.operating || {}
  const upkeep = budget.upkeep || {}
  const net = num(budget.net_usd)
  const netTone = net >= 0 ? 'text-emerald-400' : 'text-alert-red'
  const upkeepLines = upkeep.lines || []
  const history = budget.history || []

  return (
    <section className="bg-carbon-surface border border-carbon-border">
      <PanelHead
        title="Annual Operating Budget"
        right={budget.next_review_game_date
          ? `NEXT REVIEW ${budget.next_review_game_date}`
          : 'REVIEW UNAVAILABLE'}
      />
      <div className="grid grid-cols-2 lg:grid-cols-4">
        <div className="px-3 py-2.5 border-b lg:border-b-0 lg:border-r border-carbon-border">
          <div className="text-[9px] uppercase tracking-widest text-neutral-400">Appropriation</div>
          <div className="text-sm font-bold tabular-nums text-neutral-100">
            {formatUsd(appropriation.total_usd)}
          </div>
          <div className="mt-0.5 text-[9px] uppercase text-neutral-500 leading-snug">
            BASE {formatUsd(appropriation.base_usd)}
            {' // '}IPI {formatUsd(appropriation.ipi_component_usd)}
            {' // '}SI {formatUsd(appropriation.si_component_usd)}
          </div>
        </div>
        <div className="px-3 py-2.5 border-b lg:border-b-0 lg:border-r border-carbon-border">
          <div className="text-[9px] uppercase tracking-widest text-neutral-400">Operations</div>
          <div className="text-sm font-bold tabular-nums text-neutral-100">
            {formatUsd(operating.total_usd)}
          </div>
          <div className="mt-0.5 text-[9px] uppercase text-neutral-500 leading-snug">
            HQ {formatUsd(operating.headquarters_usd)}
            {' // '}{formatInt(operating.engineers)} ENG @ {formatUsd(operating.engineer_salary_usd)}
          </div>
        </div>
        <div className="px-3 py-2.5 border-b lg:border-b-0 lg:border-r border-carbon-border">
          <div className="text-[9px] uppercase tracking-widest text-neutral-400">Vehicle Upkeep</div>
          <div className="text-sm font-bold tabular-nums text-neutral-100">
            {formatUsd(upkeep.total_usd)}
          </div>
          <div className="mt-0.5 text-[9px] uppercase text-neutral-500 leading-snug">
            {formatInt(upkeep.vehicle_count)} ACTIVE UNIT
          </div>
        </div>
        <div className="px-3 py-2.5">
          <div className="text-[9px] uppercase tracking-widest text-neutral-400">Net / Year</div>
          <div className={`text-sm font-bold tabular-nums ${netTone}`}>
            {formatSignedUsd(net)}
          </div>
          <div className="mt-0.5 text-[9px] uppercase text-neutral-500 leading-snug">
            COST {formatUsd(budget.total_cost_usd)}
          </div>
        </div>
      </div>

      <div className="border-t border-carbon-border px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[9px] uppercase text-neutral-400">
        {upkeepLines.length === 0 ? (
          <span>NO ACTIVE VEHICLES</span>
        ) : (
          upkeepLines.map((line) => (
            <span key={line.type}>
              {line.count}× {toUpper(line.type)} <b className="text-neutral-200">{formatUsd(line.total_usd)}</b>
            </span>
          ))
        )}
        {history.length > 0 && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {history.slice(0, 3).map((cycle) => (
              <span key={cycle.id || cycle.cycle_year} className="text-neutral-500">
                FY{cycle.cycle_year}{' '}
                <b className={num(cycle.net_usd) >= 0 ? 'text-emerald-400' : 'text-alert-red'}>
                  {formatSignedUsd(cycle.net_usd)}
                </b>
              </span>
            ))}
          </span>
        )}
      </div>

      {budget.history_migration_required && (
        <div className="border-t border-flight-amber/40 bg-flight-amber/10 px-3 py-2 text-[9px] uppercase text-flight-amber">
          Riwayat budget aktif setelah migration 014 diterapkan. Proyeksi di atas sudah memakai data live.
        </div>
      )}
      {budget.history_error && (
        <div className="border-t border-alert-red/40 bg-alert-red/10 px-3 py-2 text-[9px] uppercase text-alert-red">
          History error: {toUpper(budget.history_error)}
        </div>
      )}
    </section>
  )
}

function RewardLine({ reward }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] uppercase tracking-wide text-neutral-400">
      <span className="text-neutral-200">{formatUsd(reward.funding_usd)}</span>
      <span>+{reward.rp || 0} RP</span>
      <span>+{reward.science_points || 0} SP</span>
    </div>
  )
}

function FeasibilityPanel({ feasibility, loading, error }) {
  const blockers = feasibility?.blockers || []
  const warnings = feasibility?.warnings || []
  const status = loading
    ? 'CHECKING'
    : error
      ? 'UNAVAILABLE'
      : !feasibility
        ? 'WAITING'
        : !feasibility.feasible
          ? 'NO-GO'
          : warnings.length > 0
            ? 'MARGINAL'
            : 'GO'
  const tone = status === 'NO-GO'
    ? 'text-alert-red'
    : status === 'MARGINAL'
      ? 'text-flight-amber'
      : status === 'GO'
        ? 'text-emerald-400'
        : 'text-neutral-400'
  const border = status === 'NO-GO'
    ? 'border-alert-red/40 bg-alert-red/5'
    : status === 'MARGINAL'
      ? 'border-flight-amber/40 bg-flight-amber/5'
      : status === 'GO'
        ? 'border-emerald-400/30 bg-emerald-400/5'
        : 'border-carbon-border bg-carbon-bg/40'

  return (
    <div className={`border px-2.5 py-2 text-[9px] ${border}`}>
      <div className="flex items-center justify-between uppercase tracking-wider">
        <span className="text-neutral-400">Feasibility // Envelope</span>
        <span className={`font-bold ${tone}`}>{status}</span>
      </div>
      {loading && (
        <div className="mt-1 uppercase text-neutral-500">Menghitung delta-v, payload, crew, funding...</div>
      )}
      {!loading && error && (
        <div className="mt-1 uppercase text-alert-red">{toUpper(error)}</div>
      )}
      {!loading && feasibility && (
        <>
          <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums text-neutral-500">
            <span>
              DV <b className="text-neutral-200">{formatInt(feasibility.delta_v_required_m_s)}/{formatInt(feasibility.delta_v_available_m_s)}</b> M/S
            </span>
            <span>
              MARGIN <b className={feasibility.delta_v_margin_m_s >= 0 ? 'text-neutral-200' : 'text-alert-red'}>
                {formatInt(feasibility.delta_v_margin_m_s)}
              </b> M/S
            </span>
            <span>
              PAYLOAD <b className="text-neutral-200">{formatInt(feasibility.payload_required_kg)}/{formatInt(feasibility.payload_capacity_kg)}</b> KG
            </span>
            <span>
              CREW <b className="text-neutral-200">{feasibility.crew_required}/{feasibility.crew_capacity}</b>
            </span>
            <span className="col-span-2">
              FUND <b className="text-neutral-200">{formatUsd(feasibility.funding_required_usd)}/{formatUsd(feasibility.funding_available_usd)}</b>
              {feasibility.inclination_penalty_m_s > 0 && ` // PLANE CHANGE +${formatInt(feasibility.inclination_penalty_m_s)} M/S`}
            </span>
          </div>
          {feasibility.estimated_cost && feasibility.estimated_duration && (
            <div className="mt-1.5 border-t border-carbon-border/60 pt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums text-neutral-500">
              <span>
                COST <b className="text-neutral-200">{formatUsd(feasibility.estimated_cost.funding_usd)}</b>
              </span>
              <span>
                DURATION <b className="text-neutral-200">
                  {formatInt(feasibility.estimated_duration.estimated_total_game_days_min)}-{formatInt(feasibility.estimated_duration.estimated_total_game_days_max)}
                </b> GD
              </span>
              <span className="col-span-2">
                BASE {formatUsd(feasibility.estimated_cost.base_funding_usd)}
                {' // '}DV {formatUsd(feasibility.estimated_cost.delta_v_funding_usd)}
                {' // '}PAYLOAD {formatUsd(feasibility.estimated_cost.payload_funding_usd)}
              </span>
              <span className="col-span-2">
                PREP +{formatInt(feasibility.estimated_duration.preparation_complexity_game_days)} GD
                {' // '}ORBIT OPS {formatInt(feasibility.estimated_duration.orbit_operations_game_days)} GD
              </span>
            </div>
          )}
          {blockers.map((blocker) => (
            <div key={`${blocker.code}-${blocker.message}`} className="mt-1 text-alert-red">
              &gt; {blocker.message}
            </div>
          ))}
          {warnings.map((warning) => (
            <div key={`${warning.code}-${warning.message}`} className="mt-1 text-flight-amber">
              &gt; {warning.message}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

export default function Economy({
  agencyId,
  agencyName,
  apiRequest,
  vehicles,
  onRefresh,
  notify,
}) {
  const [offers, setOffers] = useState(null)
  const [queueState, setQueueState] = useState({ queue: [], activeMission: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyKey, setBusyKey] = useState('')
  const [queueName, setQueueName] = useState('')
  const [queueVehicleId, setQueueVehicleId] = useState('')
  const [queueType, setQueueType] = useState('test')
  const [queueContractKey, setQueueContractKey] = useState('')
  const [feasibility, setFeasibility] = useState(null)
  const [feasibilityLoading, setFeasibilityLoading] = useState(false)
  const [feasibilityError, setFeasibilityError] = useState('')

  const readyVehicles = useMemo(
    () => (vehicles || []).filter((vehicle) => !['manufacturing', 'assigned'].includes(vehicle.status)),
    [vehicles],
  )
  const activeContracts = useMemo(
    () => (offers?.contracts || []).filter((contract) => contract.status === 'ACTIVE'),
    [offers],
  )

  const load = useCallback(async () => {
    if (!agencyId) return
    setLoading(true)
    setError('')
    try {
      const [offerData, queueData] = await Promise.all([
        apiRequest(`/economy/offers/${agencyId}`),
        apiRequest(`/launch/queue/${agencyId}`),
      ])
      setOffers(offerData)
      setQueueState({
        queue: Array.isArray(queueData?.queue) ? queueData.queue : [],
        activeMission: queueData?.activeMission || null,
      })
    } catch (err) {
      setError(err.message || 'Economy feed unavailable')
    } finally {
      setLoading(false)
    }
  }, [agencyId, apiRequest])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!readyVehicles.some((vehicle) => vehicle.id === queueVehicleId)) {
      setQueueVehicleId(readyVehicles[0]?.id || '')
    }
  }, [queueVehicleId, readyVehicles])

  useEffect(() => {
    const allowedTypes = MISSION_VEHICLE_TYPES[queueType] || []
    const compatible = readyVehicles.find((vehicle) => allowedTypes.includes(vehicle.type))
    if (compatible) setQueueVehicleId(compatible.id)
  }, [queueType, readyVehicles])

  useEffect(() => {
    if (!agencyId || !queueVehicleId || !queueType) {
      setFeasibility(null)
      setFeasibilityError('')
      setFeasibilityLoading(false)
      return undefined
    }

    let cancelled = false
    setFeasibilityLoading(true)
    setFeasibilityError('')

    const params = new URLSearchParams({ vehicleId: queueVehicleId, missionType: queueType })
    apiRequest(`/launch/feasibility/${agencyId}?${params.toString()}`)
      .then((data) => {
        if (cancelled) return
        setFeasibility(data?.feasibility || null)
      })
      .catch((err) => {
        if (cancelled) return
        setFeasibility(null)
        setFeasibilityError(err.message || 'Feasibility check failed')
      })
      .finally(() => {
        if (!cancelled) setFeasibilityLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [agencyId, apiRequest, queueType, queueVehicleId, offers?.agency?.funding_usd])

  const acceptContract = async (contract) => {
    if (!agencyId || busyKey) return
    setBusyKey(contract.key)
    try {
      await apiRequest(`/economy/contracts/${contract.key}/accept`, {
        method: 'POST',
        body: JSON.stringify({ agencyId }),
      })
      notify?.(`KONTRAK DITERIMA: ${toUpper(contract.name)}`)
      await Promise.all([load(), onRefresh?.()])
    } catch (err) {
      notify?.(`KONTRAK GAGAL: ${toUpper(err.message || 'UNKNOWN')}`)
    } finally {
      setBusyKey('')
    }
  }

  const claimGrant = async (grant) => {
    if (!agencyId || busyKey) return
    setBusyKey(grant.key)
    try {
      const result = await apiRequest(`/economy/grants/${grant.key}/claim`, {
        method: 'POST',
        body: JSON.stringify({ agencyId }),
      })
      notify?.(
        `GRANT CAIR: ${toUpper(grant.name)} // +${formatUsd(result.reward?.funding_usd)}`,
      )
      await Promise.all([load(), onRefresh?.()])
    } catch (err) {
      notify?.(`GRANT GAGAL: ${toUpper(err.message || 'UNKNOWN')}`)
    } finally {
      setBusyKey('')
    }
  }

  const queueMission = async (event) => {
    event.preventDefault()
    if (!agencyId || busyKey) return
    if (!queueVehicleId) {
      notify?.('ANTREAN DITOLAK: TIDAK ADA VEHICLE SIAP')
      return
    }
    if (feasibility && !feasibility.feasible) {
      notify?.(
        `ANTREAN DITOLAK: ${toUpper(feasibility.blockers?.map((blocker) => blocker.message).join('; ') || 'MISSION INFEASIBLE')}`,
      )
      return
    }

    setBusyKey('queue')
    try {
      const result = await apiRequest('/launch/queue', {
        method: 'POST',
        body: JSON.stringify({
          agencyId,
          missionName: queueName.trim() || `MISI-${toUpper(queueType)}-${String(Date.now()).slice(-5)}`,
          vehicleId: queueVehicleId,
          missionType: queueType,
          contractKey: queueContractKey || undefined,
        }),
      })
      const promotion = result.promotion || {}
      const costLabel = result.feasibility?.estimated_cost
        ? ` // ${formatUsd(result.feasibility.estimated_cost.funding_usd)}`
        : ''
      if (promotion.promoted) {
        notify?.(`MISI DIMULAI: ${toUpper(result.queueItem?.name || queueName)}${costLabel}`)
      } else {
        notify?.(`MISI MASUK ANTREAN // ${toUpper(promotion.reason || 'WAITING')}${costLabel}`)
      }
      setQueueName('')
      setQueueContractKey('')
      await Promise.all([load(), onRefresh?.()])
    } catch (err) {
      notify?.(`ANTREAN GAGAL: ${toUpper(err.message || 'UNKNOWN')}`)
    } finally {
      setBusyKey('')
    }
  }

  const cancelQueueItem = async (item) => {
    if (!agencyId || busyKey) return
    setBusyKey(item.id)
    try {
      await apiRequest(`/launch/queue/${item.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ agencyId }),
      })
      notify?.(`ANTREAN DIBATALKAN: ${toUpper(item.name)}`)
      await load()
    } catch (err) {
      notify?.(`CANCEL GAGAL: ${toUpper(err.message || 'UNKNOWN')}`)
    } finally {
      setBusyKey('')
    }
  }

  const dispatchQueue = async () => {
    if (!agencyId || busyKey) return
    setBusyKey('dispatch')
    try {
      const result = await apiRequest(`/launch/queue/${agencyId}/dispatch`, { method: 'POST' })
      notify?.(
        result.promotion?.promoted
          ? `ANTREAN DIMULAI: ${toUpper(result.promotion.queueItem?.name || 'MISSION')}`
          : `ANTREAN MENUNGGU: ${toUpper(result.promotion?.reason || 'NO ITEM')}`,
      )
      await Promise.all([load(), onRefresh?.()])
    } catch (err) {
      notify?.(`DISPATCH GAGAL: ${toUpper(err.message || 'UNKNOWN')}`)
    } finally {
      setBusyKey('')
    }
  }

  if (loading) {
    return (
      <div className="border border-carbon-border bg-carbon-surface px-4 py-6 text-[11px] uppercase tracking-widest text-neutral-400">
        // MEMUAT KONTRAK DAN ANTREAN<span className="afm-cursor ml-2" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-alert-red/40 bg-alert-red/10 px-4 py-3 text-[11px] uppercase text-alert-red">
        {toUpper(error)}
        <button
          type="button"
          onClick={load}
          className="ml-4 border border-alert-red/40 px-2 py-0.5 text-[10px] hover:bg-alert-red/10"
        >
          Retry
        </button>
      </div>
    )
  }

  const agency = offers?.agency || {}

  return (
    <div className="space-y-4">
      <section className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 border-b border-carbon-border pb-3">
        <div>
          <div className="text-[9px] uppercase tracking-widest text-neutral-400">
            Program Office // {toUpper(agencyName)}
          </div>
          <h1 className="font-headline font-bold text-base uppercase text-neutral-100 tracking-tight">
            Contracts &amp; Mission Queue
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-[10px] uppercase tabular-nums">
          <span className="text-neutral-400">
            FUNDING <b className="text-neutral-100">{formatUsd(agency.funding_usd)}</b>
          </span>
          <span className="text-neutral-400">
            SP <b className="text-neutral-100">{num(agency.science_points)}</b>
          </span>
          <span className="text-neutral-400">
            LAUNCH <b className="text-neutral-100">{num(agency.total_launches)}</b>
          </span>
        </div>
      </section>

      <BudgetPanel budget={offers?.budget} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section className="bg-carbon-surface border border-carbon-border">
          <PanelHead title="Grants // One-time" right={`${offers?.grants?.length || 0} PROGRAM`} />
          <div className="divide-y divide-carbon-border">
            {(offers?.grants || []).map((grant) => (
              <div key={grant.key} className="px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase text-neutral-100 truncate">
                      {toUpper(grant.name)}
                    </div>
                    <p className="text-[10px] text-neutral-400 leading-snug mt-0.5">{grant.description}</p>
                    <div className="mt-1.5">
                      <RewardLine
                        reward={{ funding_usd: grant.reward.funding_usd, rp: 0, science_points: grant.reward.science_points }}
                      />
                    </div>
                    {grant.requirement && (
                      <div className="mt-1 text-[9px] uppercase text-neutral-500">
                        SYARAT: {grant.requirement}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => claimGrant(grant)}
                    disabled={!grant.can_claim || Boolean(busyKey)}
                    className={`shrink-0 border px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider bezier-fast ${
                      grant.claimed
                        ? 'border-carbon-border text-neutral-500 cursor-default'
                        : grant.can_claim
                          ? 'border-flight-amber text-flight-amber hover:bg-flight-amber hover:text-black'
                          : 'border-carbon-border text-neutral-500 cursor-not-allowed'
                    }`}
                  >
                    {grant.claimed ? 'Claimed' : grant.can_claim ? 'Claim' : 'Locked'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-carbon-surface border border-carbon-border">
          <PanelHead title="Contracts // Mission" right={`${activeContracts.length} ACTIVE`} />
          <div className="divide-y divide-carbon-border">
            {(offers?.contracts || []).map((contract) => (
              <div key={contract.key} className="px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold uppercase text-neutral-100 truncate">
                        {toUpper(contract.name)}
                      </span>
                      <span className={`text-[9px] uppercase ${STATUS_TONE[contract.status] || 'text-neutral-400'}`}>
                        {contract.status}
                      </span>
                    </div>
                    <p className="text-[10px] text-neutral-400 leading-snug mt-0.5">{contract.description}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[9px] uppercase text-flight-amber">
                        {MISSION_LABEL[contract.mission_type] || toUpper(contract.mission_type)}
                      </span>
                      <RewardLine reward={contract.reward} />
                    </div>
                    {contract.requirement && (
                      <div className="mt-1 text-[9px] uppercase text-neutral-500">
                        SYARAT: {contract.requirement}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => acceptContract(contract)}
                    disabled={!contract.can_accept || Boolean(busyKey)}
                    className={`shrink-0 border px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider bezier-fast ${
                      contract.status === 'ACTIVE'
                        ? 'border-flight-amber/40 text-flight-amber'
                        : contract.status === 'COMPLETED'
                          ? 'border-emerald-400/40 text-emerald-400 cursor-default'
                          : contract.can_accept
                            ? 'border-flight-amber text-flight-amber hover:bg-flight-amber hover:text-black'
                            : 'border-carbon-border text-neutral-500 cursor-not-allowed'
                    }`}
                  >
                    {contract.status === 'AVAILABLE'
                      ? contract.can_accept
                        ? 'Accept'
                        : 'Locked'
                      : contract.status}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="bg-carbon-surface border border-carbon-border">
        <PanelHead
          title="Mission Queue // Sequential"
          right={`${queueState.queue.filter((item) => ['QUEUED', 'ACTIVE'].includes(item.status)).length} PENDING`}
        />
        <div className="p-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <form onSubmit={queueMission} className="space-y-2.5">
            <div className="text-[9px] uppercase tracking-wider text-neutral-400">
              Tambah antrean misi
            </div>
            <label className="flex flex-col gap-1 text-[9px] uppercase text-neutral-400">
              Contract
              <select
                value={queueContractKey}
                onChange={(event) => {
                  const key = event.target.value
                  setQueueContractKey(key)
                  const selected = activeContracts.find((contract) => contract.key === key)
                  if (selected) setQueueType(selected.mission_type)
                }}
                className="h-8 bg-carbon-bg border border-carbon-border px-2 text-[10px] text-neutral-100"
              >
                <option value="">NO CONTRACT</option>
                {activeContracts.map((contract) => (
                  <option key={contract.key} value={contract.key}>
                    {contract.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[9px] uppercase text-neutral-400">
                Mission Type
                <select
                  value={queueType}
                  onChange={(event) => setQueueType(event.target.value)}
                  className="h-8 bg-carbon-bg border border-carbon-border px-2 text-[10px] text-neutral-100"
                >
                  {Object.entries(MISSION_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[9px] uppercase text-neutral-400">
                Vehicle
                <select
                  value={queueVehicleId}
                  onChange={(event) => setQueueVehicleId(event.target.value)}
                  className="h-8 bg-carbon-bg border border-carbon-border px-2 text-[10px] text-neutral-100"
                >
                  {readyVehicles.length === 0 && <option value="">NO READY VEHICLE</option>}
                  {readyVehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.name} // {vehicle.type} // {vehicle.status}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <FeasibilityPanel
              feasibility={feasibility}
              loading={feasibilityLoading}
              error={feasibilityError}
            />
            <label className="flex flex-col gap-1 text-[9px] uppercase text-neutral-400">
              Mission Name
              <input
                value={queueName}
                onChange={(event) => setQueueName(event.target.value)}
                placeholder="AUTO"
                maxLength={60}
                spellCheck={false}
                autoComplete="off"
                className="h-8 bg-carbon-bg border border-carbon-border px-2 text-[10px] text-neutral-100 placeholder:text-neutral-500"
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={
                  Boolean(busyKey)
                  || readyVehicles.length === 0
                  || feasibilityLoading
                  || feasibility?.feasible === false
                }
                className="flex-1 bg-flight-amber hover:bg-flight-amber-dim text-black px-3 py-2 text-[10px] font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busyKey === 'queue'
                  ? 'QUEUEING...'
                  : feasibilityLoading
                    ? 'CHECKING...'
                    : feasibility?.feasible === false
                      ? 'Infeasible'
                      : 'Queue Mission'}
              </button>
              <button
                type="button"
                onClick={dispatchQueue}
                disabled={Boolean(busyKey)}
                className="border border-carbon-border text-neutral-300 hover:text-flight-amber hover:border-flight-amber/50 px-3 py-2 text-[10px] font-bold uppercase tracking-wider disabled:opacity-50"
              >
                Dispatch
              </button>
            </div>
            <p className="text-[9px] text-neutral-500 leading-snug">
              Misi berjalan satu per satu. Berikutnya otomatis dimulai setelah misi aktif selesai.
            </p>
          </form>

          <div className="min-w-0">
            <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-neutral-400 mb-1.5">
              <span>Antrean</span>
              <span>
                {queueState.activeMission
                  ? `ACTIVE: ${toUpper(queueState.activeMission.name)} // ${queueState.activeMission.status}`
                  : 'PAD IDLE'}
              </span>
            </div>
            <div className="max-h-[300px] overflow-y-auto custom-scroll divide-y divide-carbon-border border border-carbon-border">
              {queueState.queue.length === 0 ? (
                <div className="px-3 py-8 text-center text-[10px] uppercase text-neutral-500">
                  Antrean kosong
                </div>
              ) : (
                queueState.queue.map((item) => (
                  <div key={item.id} className="px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase text-neutral-100 truncate">
                            {toUpper(item.name)}
                          </span>
                          <span className={`text-[9px] uppercase ${STATUS_TONE[item.status] || 'text-neutral-400'}`}>
                            {item.status}
                          </span>
                        </div>
                        <div className="text-[9px] uppercase text-neutral-400 mt-0.5">
                          {MISSION_LABEL[item.mission_type] || toUpper(item.mission_type)}
                          {item.contract_name ? ` // ${toUpper(item.contract_name)}` : ''}
                        </div>
                        {item.error && (
                          <div className="text-[9px] text-alert-red mt-0.5">{item.error}</div>
                        )}
                        {item.started_at && (
                          <div className="text-[9px] text-neutral-500 mt-0.5">
                            START {formatTime(item.started_at)}
                          </div>
                        )}
                      </div>
                      {item.status === 'QUEUED' && (
                        <button
                          type="button"
                          onClick={() => cancelQueueItem(item)}
                          disabled={Boolean(busyKey)}
                          className="shrink-0 border border-carbon-border px-2 py-0.5 text-[9px] uppercase text-neutral-400 hover:text-alert-red hover:border-alert-red/50 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      {(offers?.recent_rewards || []).length > 0 && (
        <section className="bg-carbon-surface border border-carbon-border">
          <PanelHead title="Recent Mission Rewards" right={`${offers.recent_rewards.length}`} />
          <div className="divide-y divide-carbon-border">
            {offers.recent_rewards.map((reward) => (
              <div key={reward.id} className="px-3 py-1.5 flex items-center justify-between gap-2 text-[10px]">
                <span className="text-neutral-300 truncate">
                  {formatUsd(reward.funding_usd)} // +{reward.rp} RP // +{reward.science_points} SP
                </span>
                <span className="text-neutral-500 uppercase">{formatTime(reward.created_at)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
