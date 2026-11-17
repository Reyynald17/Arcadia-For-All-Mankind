import { useEffect, useMemo, useState } from 'react'

const COL_W = 206
const NODE_W = 182
const NODE_H = 74
const NODE_GAP = 8
const BAND_PAD = 16
const RAIL_W = 64
const RIGHT_RAIL = 54
const HEADER_H = 40
const CANVAS_RIGHT = 10
const ERAS = [1, 2, 3, 4]

const DISCIPLINES = [
  { id: 'PROP', label: 'Propulsi' },
  { id: 'STRC', label: 'Struktur' },
  { id: 'AVNC', label: 'Avionik' },
  { id: 'SCNC', label: 'Sains & Kom' },
  { id: 'LIFE', label: 'Life Support' },
  { id: 'POWR', label: 'Daya' },
]

const ERA_META = {
  1: { code: 'ERA I', years: '1945–58' },
  2: { code: 'ERA II', years: '1959–69' },
  3: { code: 'ERA III', years: '1970–79' },
  4: { code: 'ERA IV', years: '1980–89' },
}

const STATUS_LABEL = {
  completed: 'TRL AKTIF',
  in_progress: 'DITELITI',
  qualified: 'SIAP',
  locked: 'TERKUNCI',
  embargoed: 'EMBARGO',
}

const STATUS_TONE = {
  completed: 'text-flight-amber',
  in_progress: 'text-flight-amber',
  qualified: 'text-neutral-300',
  locked: 'text-neutral-500',
  embargoed: 'text-alert-red',
}

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
const clamp = (value) => Math.max(0, Math.min(100, num(value)))
const pad = (value) => String(value).padStart(2, '0')
const toUpper = (value) => String(value ?? '').toUpperCase()

function formatUsd(value) {
  const amount = num(value)
  if (amount >= 1000000000) return `$${(amount / 1000000000).toFixed(2)}B`
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`
  if (amount >= 1000) return `$${Math.round(amount / 1000)}K`
  return `$${Math.round(amount)}`
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${pad(date.getUTCDate())} ${date.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }).toUpperCase()}`
}

function xpRequired(level) {
  const trl = Math.max(4, Math.min(9, Math.floor(num(level))))
  return 100 * 1.6 ** (trl - 4)
}

function progressFor(row) {
  if (row.status !== 'in_progress') return 0
  const start = new Date(row.node?.research_started_at || '').getTime()
  const end = new Date(row.node?.research_completes_at || '').getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  return clamp(Math.round(((Date.now() - start) / (end - start)) * 100))
}

function disciplineFor(tech) {
  const id = String(tech.discipline_id || '').toUpperCase()
  if (DISCIPLINES.some((discipline) => discipline.id === id)) return id
  return 'PROP'
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

function buildLayout(rows) {
  const columns = DISCIPLINES.map((discipline) => ({
    ...discipline,
    groups: new Map(),
    total: 0,
    completed: 0,
  }))

  for (const row of rows) {
    const column = columns.find((item) => item.id === disciplineFor(row.tech)) || columns[0]
    const era = Math.min(4, Math.max(1, num(row.tier) || 1))
    if (!column.groups.has(era)) column.groups.set(era, [])
    column.groups.get(era).push(row)
    column.total += 1
    if (row.status === 'completed') column.completed += 1
  }

  for (const column of columns) {
    for (const group of column.groups.values()) {
      group.sort((a, b) => String(a.tech.name).localeCompare(String(b.tech.name)))
    }
  }

  const bands = []
  let cursor = 0
  for (const era of ERAS) {
    const maxCount = Math.max(0, ...columns.map((column) => (column.groups.get(era) || []).length))
    const height = maxCount === 0
      ? 58
      : maxCount * NODE_H + (maxCount - 1) * NODE_GAP + BAND_PAD * 2
    bands.push({ era, y: cursor, height })
    cursor += height
  }

  const bandByEra = new Map(bands.map((band) => [band.era, band]))
  const positions = new Map()

  columns.forEach((column, columnIndex) => {
    const x = RAIL_W + columnIndex * COL_W + (COL_W - NODE_W) / 2
    for (const [era, group] of column.groups.entries()) {
      const band = bandByEra.get(era)
      if (!band) continue
      const groupHeight = group.length * NODE_H + (group.length - 1) * NODE_GAP
      let y = band.y + (band.height - groupHeight) / 2
      for (const row of group) {
        positions.set(row.tech.node_id, { x, y })
        y += NODE_H + NODE_GAP
      }
    }
  })

  return {
    columns,
    bands,
    positions,
    width: RAIL_W + columns.length * COL_W + RIGHT_RAIL + CANVAS_RIGHT,
    height: cursor,
    rowByNode: new Map(rows.map((row) => [row.tech.node_id, row])),
  }
}

function edgePath(from, to) {
  const x1 = from.x + NODE_W / 2
  const y1 = from.y + NODE_H
  const x2 = to.x + NODE_W / 2
  const y2 = to.y
  if (Math.abs(x1 - x2) < 1) return `M ${x1} ${y1} L ${x2} ${y2}`
  const midY = y1 + Math.max(16, (y2 - y1) * 0.45)
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
}

export default function TechTree({
  rows,
  loading,
  error,
  onRetry,
  researchBusy,
  staticFireBusy,
  sciencePoints,
  fundingUsd,
  onStartResearch,
  onStaticFire,
}) {
  const [selectedId, setSelectedId] = useState(null)
  const [missingArt, setMissingArt] = useState(() => new Set())
  const [, setTick] = useState(0)

  const handleArtError = (nodeId) => {
    setMissingArt((current) => {
      if (current.has(nodeId)) return current
      const next = new Set(current)
      next.add(nodeId)
      return next
    })
  }

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 30000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (selectedId && rows.some((row) => row.tech.node_id === selectedId)) return
    const preferred =
      rows.find((row) => row.status === 'in_progress')
      || rows.find((row) => row.status === 'qualified')
      || rows[0]
      || null
    setSelectedId(preferred?.tech.node_id || null)
  }, [rows, selectedId])

  const layout = useMemo(() => buildLayout(rows), [rows])

  const edges = useMemo(() => {
    const list = []
    for (const row of rows) {
      const prereqIds = Array.isArray(row.tech.prerequisite_node_ids)
        ? row.tech.prerequisite_node_ids.filter(Boolean)
        : []
      for (const prereqId of prereqIds) {
        const source = layout.rowByNode.get(prereqId)
        const from = layout.positions.get(prereqId)
        const to = layout.positions.get(row.tech.node_id)
        if (!source || !from || !to) continue
        list.push({
          key: `${prereqId}->${row.tech.node_id}`,
          from,
          to,
          source,
          target: row,
        })
      }
    }
    return list
  }, [layout, rows])

  const completedCount = rows.filter((row) => row.status === 'completed').length
  const inProgressCount = rows.filter((row) => row.status === 'in_progress').length
  const selectedRow = useMemo(
    () => rows.find((row) => row.tech.node_id === selectedId) || null,
    [rows, selectedId],
  )

  const selectedPrereqs = useMemo(() => {
    if (!selectedRow) return []
    const prereqIds = Array.isArray(selectedRow.tech.prerequisite_node_ids)
      ? selectedRow.tech.prerequisite_node_ids.filter(Boolean)
      : []
    return prereqIds.map((nodeId) => {
      const row = layout.rowByNode.get(nodeId)
      return {
        nodeId,
        name: row?.tech.name || nodeId,
        met: row?.status === 'completed',
      }
    })
  }, [layout, selectedRow])

  const renderAction = () => {
    if (!selectedRow) return null
    const { status, tech, node } = selectedRow
    const testCost = num(tech.static_test_cost)
    const currentTrl = num(node?.current_trl)
    const affordable = sciencePoints >= selectedRow.scienceCost && fundingUsd >= selectedRow.fundingCost
    const shortfall = []
    if (sciencePoints < selectedRow.scienceCost) {
      shortfall.push(`${selectedRow.scienceCost - sciencePoints} SP`)
    }
    if (fundingUsd < selectedRow.fundingCost) {
      shortfall.push(formatUsd(selectedRow.fundingCost - fundingUsd))
    }

    if (status === 'qualified') {
      return (
        <button
          type="button"
          onClick={() => onStartResearch(selectedRow)}
          disabled={Boolean(researchBusy) || !affordable}
          className={`border px-3 py-2 text-[9px] font-bold uppercase tracking-wider bezier-fast ${
            affordable
              ? 'border-flight-amber bg-flight-amber text-black hover:bg-flight-amber-dim'
              : 'border-carbon-border text-neutral-500 cursor-not-allowed'
          }`}
        >
          {researchBusy === tech.node_id
            ? 'Memulai...'
            : affordable
              ? `Mulai Riset // ${selectedRow.baseDays} hari`
              : `Kurang ${shortfall.join(' + ')}`}
        </button>
      )
    }

    if (status === 'completed' && currentTrl < 9) {
      return (
        <button
          type="button"
          onClick={() => onStaticFire(selectedRow)}
          disabled={Boolean(staticFireBusy) || fundingUsd < testCost}
          className={`border px-3 py-2 text-[9px] font-bold uppercase tracking-wider bezier-fast ${
            fundingUsd >= testCost
              ? 'border-carbon-border-light text-neutral-200 hover:border-flight-amber hover:text-flight-amber'
              : 'border-carbon-border text-neutral-500 cursor-not-allowed'
          }`}
        >
          {staticFireBusy === tech.node_id ? 'Menjadwalkan...' : `Uji Statis // ${formatUsd(testCost)}`}
        </button>
      )
    }

    const label = status === 'completed'
      ? 'TRL 9 // MAX'
      : status === 'in_progress'
        ? 'Riset Berjalan // Async'
        : status === 'embargoed'
          ? 'Expor Terkendali'
          : 'Prasyarat Belum Terpenuhi'

    return (
      <div className="border border-carbon-border px-3 py-2 text-[9px] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
    )
  }

  return (
    <section className="bg-carbon-surface border border-carbon-border flex flex-col min-w-0">
      <PanelHead
        title="Pohon Teknologi"
        right={`${completedCount}/${rows.length} TRL AKTIF // ${inProgressCount} DITELITI`}
      />

      {loading ? (
        <div className="py-16 text-center text-[11px] text-neutral-400">
          // SINKRONISASI MATRIKS<span className="afm-cursor ml-2" />
        </div>
      ) : error ? (
        <div className="px-3 py-4 text-[11px] text-alert-red">
          <p>&gt; MATRIKS OFFLINE: {toUpper(error)}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 border border-alert-red/50 hover:bg-alert-red/10 px-2 py-1 text-[10px] font-bold uppercase"
          >
            Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="py-10 text-center text-[10px] text-neutral-400 uppercase">
          Tidak ada node teknologi
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 block mx-auto border border-carbon-border hover:border-carbon-border-light px-2 py-1 font-bold text-neutral-200"
          >
            Refresh
          </button>
        </div>
      ) : (
        <>
          <div className="relative overflow-auto custom-scroll max-h-[620px]">
            <div style={{ width: layout.width }}>
              <div
                className="sticky top-0 z-20 flex border-b border-carbon-border bg-carbon-surface"
                style={{ width: layout.width, height: HEADER_H }}
              >
                <div
                  className="flex shrink-0 items-center px-2 text-[8px] uppercase tracking-widest text-neutral-500"
                  style={{ width: RAIL_W }}
                >
                  Tahun
                </div>
                {layout.columns.map((column) => (
                  <div
                    key={column.id}
                    className="flex shrink-0 items-center gap-1.5 border-l border-carbon-border px-2"
                    style={{ width: COL_W }}
                  >
                    <span className="truncate text-[8px] font-bold uppercase tracking-widest text-neutral-300">
                      {column.label}
                    </span>
                    <span className="ml-auto text-[8px] tabular-nums text-neutral-500">
                      {column.completed}/{column.total}
                    </span>
                  </div>
                ))}
                <div className="shrink-0" style={{ width: RIGHT_RAIL + CANVAS_RIGHT }} />
              </div>

              <div className="relative" style={{ width: layout.width, height: layout.height }}>
                {layout.bands.map((band, index) => {
                  const meta = ERA_META[band.era]
                  return (
                    <div
                      key={band.era}
                      className="absolute inset-x-0 border-t border-carbon-border/70"
                      style={{
                        top: band.y,
                        height: band.height,
                        background: index % 2 === 0 ? 'rgba(255,255,255,0.012)' : 'transparent',
                      }}
                    >
                      <div className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none">
                        <div className="text-[8px] font-bold uppercase tracking-widest text-neutral-400">
                          {meta.code}
                        </div>
                        <div className="text-[7px] tabular-nums text-neutral-500">{meta.years}</div>
                      </div>
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 text-right pointer-events-none">
                        <div className="text-[8px] font-bold uppercase tracking-widest text-neutral-500">
                          {meta.code}
                        </div>
                        <div className="text-[7px] tabular-nums text-neutral-600">{meta.years}</div>
                      </div>
                    </div>
                  )
                })}

                {layout.columns.map((column, index) => (
                  <div
                    key={`rail-${column.id}`}
                    className="absolute top-0 bottom-0 w-px bg-carbon-border/50 pointer-events-none"
                    style={{ left: RAIL_W + index * COL_W }}
                  />
                ))}
                <div
                  className="absolute top-0 bottom-0 w-px bg-carbon-border/70 pointer-events-none"
                  style={{ left: layout.width - RIGHT_RAIL - CANVAS_RIGHT }}
                />

                <svg
                  className="absolute inset-0 pointer-events-none"
                  width={layout.width}
                  height={layout.height}
                  aria-hidden="true"
                >
                  {edges.map((edge) => {
                    const highlighted =
                      selectedId
                      && (edge.source.tech.node_id === selectedId
                        || edge.target.tech.node_id === selectedId)
                    const completedLink =
                      edge.source.status === 'completed' && edge.target.status === 'completed'
                    const activeLink =
                      edge.source.status === 'completed'
                      && ['qualified', 'in_progress'].includes(edge.target.status)
                    const stroke = highlighted
                      ? '#D97706'
                      : completedLink
                        ? '#B45309'
                        : activeLink
                          ? '#52525B'
                          : '#27272A'
                    return (
                      <path
                        key={edge.key}
                        d={edgePath(edge.from, edge.to)}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={highlighted ? 1.6 : 1}
                        strokeLinecap="round"
                      />
                    )
                  })}
                </svg>

                {rows.map((row) => {
                  const position = layout.positions.get(row.tech.node_id)
                  if (!position) return null
                  const selected = selectedId === row.tech.node_id
                  const progress = progressFor(row)
                  const currentTrl = num(row.node?.current_trl)
                  const trlXp = num(row.node?.trl_xp)
                  const nextXp = currentTrl < 9 ? xpRequired(currentTrl) : 0
                  const badge =
                    row.status === 'completed'
                      ? `TRL ${currentTrl}`
                      : row.status === 'in_progress'
                        ? `${progress}%`
                        : row.status === 'qualified'
                          ? 'SIAP'
                          : row.status === 'embargoed'
                            ? 'EMBARGO'
                            : 'KUNCI'
                  const artSrc = `/tech-tree/nodes/${String(row.tech.node_id).toLowerCase().replace(/_/g, '-')}.png`
                  const showArt = !missingArt.has(row.tech.node_id)

                  const cardTone =
                    row.status === 'completed'
                      ? 'border-flight-amber/40 bg-[#16130E] hover:border-flight-amber/80'
                      : row.status === 'in_progress'
                        ? 'border-flight-amber bg-flight-amber/[0.07]'
                        : row.status === 'qualified'
                          ? 'border-carbon-border-light bg-carbon-container hover:border-flight-amber/70'
                          : row.status === 'embargoed'
                            ? 'border-alert-red/40 bg-alert-red/[0.04] opacity-80'
                            : 'border-carbon-border bg-[#0E0E10] opacity-55 hover:opacity-85'

                  return (
                    <button
                      key={row.tech.node_id}
                      type="button"
                      onClick={() => setSelectedId(row.tech.node_id)}
                      aria-pressed={selected}
                      aria-label={`${row.tech.name}, ${STATUS_LABEL[row.status]}`}
                      className={`absolute z-10 overflow-hidden border text-left bezier-fast ${cardTone}`}
                      style={{
                        left: position.x,
                        top: position.y,
                        width: NODE_W,
                        height: NODE_H,
                        boxShadow: selected
                          ? '0 0 0 1px #D97706, 0 0 18px rgba(217,119,6,0.12)'
                          : undefined,
                      }}
                    >
                      {showArt && (
                        <img
                          src={artSrc}
                          alt=""
                          aria-hidden="true"
                          draggable={false}
                          loading="lazy"
                          onError={() => handleArtError(row.tech.node_id)}
                          className={`pointer-events-none absolute inset-0 h-full w-full object-cover ${
                            row.status === 'embargoed'
                              ? 'opacity-25 grayscale'
                              : row.status === 'locked'
                                ? 'opacity-35 grayscale'
                                : row.status === 'in_progress'
                                  ? 'opacity-100'
                                  : row.status === 'completed'
                                    ? 'opacity-90'
                                    : 'opacity-80'
                          }`}
                        />
                      )}
                      <div className="pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-[#09090B]/80 to-transparent" />
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-11 bg-gradient-to-t from-[#09090B] via-[#09090B]/65 to-transparent" />

                      <div className="relative z-10 flex h-full flex-col p-1.5">
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className={`text-[7px] font-bold uppercase tracking-widest drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] ${
                              row.status === 'completed' || row.status === 'in_progress'
                                ? 'text-flight-amber'
                                : 'text-neutral-400'
                            }`}
                          >
                            {disciplineFor(row.tech)}
                          </span>
                          <span className={`text-[8px] font-bold uppercase tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] ${STATUS_TONE[row.status]}`}>
                            {badge}
                          </span>
                        </div>

                        <div
                          className={`mt-1 text-[9px] font-headline font-bold uppercase leading-[1.15] drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] ${
                            row.status === 'locked' ? 'text-neutral-500' : 'text-neutral-100'
                          }`}
                          style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {row.tech.name}
                        </div>

                        <div className="mt-auto flex items-center justify-between gap-1 text-[8px] tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
                          {row.status === 'completed' ? (
                            <>
                              <span className="text-neutral-400">
                                XP {Math.round(trlXp)}
                                {currentTrl < 9 ? `/${Math.round(nextXp)}` : ''}
                              </span>
                              <span className="text-neutral-500">
                                {currentTrl >= 9 ? 'MAX' : `${Math.round((trlXp / (nextXp || 1)) * 100)}%`}
                              </span>
                            </>
                          ) : row.status === 'in_progress' ? (
                            <>
                              <span className="text-flight-amber">DITELITI</span>
                              <span className="text-neutral-400">~{formatDate(row.node?.research_completes_at)}</span>
                            </>
                          ) : (
                            <>
                              <span className={row.status === 'locked' ? 'text-neutral-600' : 'text-neutral-400'}>
                                {row.scienceCost} SP
                              </span>
                              <span className="text-neutral-500">{row.baseDays}D</span>
                            </>
                          )}
                        </div>

                        {row.status === 'in_progress' && (
                          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-carbon-bg">
                            <div className="h-full bg-flight-amber" style={{ width: `${progress}%` }} />
                          </div>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="border-t border-carbon-border bg-carbon-bg/30 px-3 py-2.5">
            {selectedRow ? (
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[8px] uppercase tracking-widest">
                    <span className={`font-bold ${STATUS_TONE[selectedRow.status]}`}>
                      {STATUS_LABEL[selectedRow.status]}
                    </span>
                    <span className="text-neutral-600">//</span>
                    <span className="text-neutral-400">
                      {DISCIPLINES.find((item) => item.id === disciplineFor(selectedRow.tech))?.label}
                      {' // '}
                      {ERA_META[Math.min(4, Math.max(1, num(selectedRow.tier) || 1))].code}
                    </span>
                    {selectedRow.prereqNames.length > 0 && (
                      <span className="hidden sm:inline text-neutral-500">
                        {selectedRow.prereqNames.length} prasyarat
                      </span>
                    )}
                  </div>

                  <h3 className="mt-0.5 font-headline text-[12px] font-bold uppercase leading-tight text-neutral-100">
                    {selectedRow.tech.name}
                  </h3>
                  <p className="mt-0.5 max-w-3xl text-[9px] leading-snug text-neutral-400">
                    {selectedRow.tech.description || 'Tidak ada deskripsi teknis.'}
                  </p>

                  {selectedPrereqs.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span className="text-[8px] uppercase tracking-wider text-neutral-500">Prasyarat:</span>
                      {selectedPrereqs.map((prereq) => (
                        <span
                          key={prereq.nodeId}
                          className={`border px-1.5 py-0.5 text-[8px] uppercase ${
                            prereq.met
                              ? 'border-carbon-border-light text-neutral-300'
                              : 'border-alert-red/30 text-alert-red/80'
                          }`}
                        >
                          {prereq.met ? 'OK' : 'NEED'} // {prereq.name}
                        </span>
                      ))}
                    </div>
                  )}

                  {selectedRow.status === 'in_progress' && (
                    <div className="mt-2 max-w-md">
                      <div className="h-1 bg-carbon-bg">
                        <div className="h-full bg-flight-amber" style={{ width: `${progressFor(selectedRow)}%` }} />
                      </div>
                      <div className="mt-0.5 flex justify-between text-[8px] tabular-nums text-neutral-400">
                        <span>{progressFor(selectedRow)}% // ASYNC</span>
                        <span>SELESAI ~{formatDate(selectedRow.node?.research_completes_at)}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center lg:flex-row">
                  <div className="min-w-[160px] border-l-0 sm:border-l sm:border-carbon-border sm:pl-4 text-[9px] leading-relaxed tabular-nums text-neutral-300">
                    {selectedRow.status === 'completed' ? (
                      <>
                        <div>
                          <span className="text-neutral-500">TRL </span>
                          {num(selectedRow.node?.current_trl)}/9
                          <span className="ml-2 text-neutral-500">XP </span>
                          {Math.round(num(selectedRow.node?.trl_xp))}
                          {num(selectedRow.node?.current_trl) < 9
                            ? `/${Math.round(xpRequired(num(selectedRow.node?.current_trl)))}`
                            : ''}
                        </div>
                        <div className="text-neutral-400">
                          {num(selectedRow.node?.total_activations)} TEST // {num(selectedRow.node?.failures_recorded)} ANOMALI
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <span className="text-neutral-500">SP </span>
                          {selectedRow.scienceCost}
                          <span className="ml-2 text-neutral-500">FUNDING </span>
                          {formatUsd(selectedRow.fundingCost)}
                        </div>
                        <div className="text-neutral-400">
                          {selectedRow.baseDays} HARI GAME
                          {selectedRow.status === 'in_progress' ? ' // ASYNC' : ''}
                        </div>
                      </>
                    )}
                  </div>
                  {renderAction()}
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[8px] uppercase tracking-wider text-neutral-500">
                <span>Klik node untuk detail</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 border border-carbon-border-light" /> SiAP</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 border border-flight-amber bg-flight-amber/20" /> DITELITI</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 bg-flight-amber" /> TRL AKTIF</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 border border-carbon-border opacity-60" /> TERKUNCI</span>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
