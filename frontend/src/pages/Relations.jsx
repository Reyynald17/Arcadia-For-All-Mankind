import { useCallback, useEffect, useMemo, useState } from 'react'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'agencies', label: 'Agencies' },
  { id: 'inbox', label: 'Inbox / Proposals' },
  { id: 'agreements', label: 'Agreements' },
  { id: 'detail', label: 'Relation Detail' },
]

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)

function formatUsd(value) {
  const amount = num(value)
  if (amount >= 1000000000) return `$${(amount / 1000000000).toFixed(2)}B`
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`
  if (amount >= 1000) return `$${Math.round(amount / 1000)}K`
  return `$${Math.round(amount)}`
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toISOString().slice(0, 10)
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.toISOString().slice(0, 16).replace('T', ' ')}Z`
}

function formatCountdown(value, nowTick) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const diff = date.getTime() - nowTick
  if (diff <= 0) return 'EXPIRED'
  const days = Math.floor(diff / 86400000)
  const hours = Math.floor((diff % 86400000) / 3600000)
  const minutes = Math.floor((diff % 3600000) / 60000)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function titleCase(value) {
  return String(value ?? '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function eventLabel(value) {
  return titleCase(String(value ?? '').replace(/^DIPLOMACY_/, ''))
}

const STATUS_TONE = {
  pending: 'border-flight-amber/50 text-flight-amber',
  accepted: 'border-telemetry-green/50 text-telemetry-green',
  active: 'border-telemetry-green/50 text-telemetry-green',
  cooperative: 'border-telemetry-green/50 text-telemetry-green',
  allied: 'border-telemetry-green/60 text-telemetry-green',
  rejected: 'border-alert-red/50 text-alert-red',
  terminated: 'border-alert-red/50 text-alert-red',
  expired: 'border-alert-red/40 text-alert-red',
  withdrawn: 'border-carbon-border-light text-neutral-400',
  countered: 'border-carbon-border-light text-neutral-300',
  neutral: 'border-carbon-border-light text-neutral-300',
  sanctioned: 'border-alert-red/50 text-alert-red',
  inactive: 'border-carbon-border-light text-neutral-400',
}

const BLOC_TONE = {
  western: 'border-telemetry-cyan/40 text-telemetry-cyan',
  eastern: 'border-alert-red/40 text-alert-red',
  neutral: 'border-carbon-border-light text-neutral-300',
}

function Badge({ children, tone = 'neutral', className = '' }) {
  return (
    <span
      className={`inline-flex items-center border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider whitespace-nowrap ${STATUS_TONE[tone] || STATUS_TONE.neutral} ${className}`}
    >
      {children}
    </span>
  )
}

function BlocBadge({ bloc }) {
  return (
    <span
      className={`inline-flex items-center border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${BLOC_TONE[bloc] || BLOC_TONE.neutral}`}
    >
      {bloc || 'neutral'}
    </span>
  )
}

function ControllerBadge({ agency }) {
  if (!agency) return null
  if (agency.controller_type === 'npc') {
    return <Badge tone="pending">NPC</Badge>
  }
  return <Badge tone="active">Player</Badge>
}

function Panel({ title, right, children, className = '' }) {
  return (
    <section className={`bg-carbon-surface border border-carbon-border flex flex-col ${className}`}>
      <div className="flex items-baseline justify-between gap-2 px-3 py-2 border-b border-carbon-border">
        <h2 className="font-headline text-[11px] font-bold uppercase tracking-widest text-neutral-200 truncate">
          {title}
        </h2>
        {right ? <span className="text-[10px] text-neutral-400 whitespace-nowrap">{right}</span> : null}
      </div>
      {children}
    </section>
  )
}

function EmptyState({ children }) {
  return (
    <div className="px-3 py-6 text-center text-[10px] uppercase tracking-wider text-neutral-400">
      {children}
    </div>
  )
}

function SaturationMeter({ entry }) {
  const total = num(entry?.blocAgencyCount)
  const used = num(entry?.counterpartCount)
  const cap = num(entry?.threshold)
  const width = total > 0 ? Math.min(100, (used / total) * 100) : 0
  const capWidth = total > 0 ? Math.min(100, (cap / total) * 100) : 0

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BlocBadge bloc={entry?.bloc} />
          <span className="text-[10px] text-neutral-400 uppercase tracking-wider">Counterparts</span>
        </div>
        {entry?.isSaturated ? (
          <Badge tone="terminated">{String(entry.bloc || '').toUpperCase()} SATURATED</Badge>
        ) : (
          <span className="text-[9px] uppercase tracking-wider text-neutral-400">NORMAL</span>
        )}
      </div>
      <div className="relative h-2 bg-carbon-bg border border-carbon-border">
        <div
          className={`h-full ${entry?.isSaturated ? 'bg-alert-red' : 'bg-flight-amber'}`}
          style={{ width: `${width}%` }}
        />
        <div
          className="absolute top-[-2px] bottom-[-2px] w-px bg-neutral-100/80"
          style={{ left: `${capWidth}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-neutral-400">
        <span>
          <b className="text-neutral-100">{used}</b>/{total} counterparts
        </span>
        <span>CAP {cap}</span>
      </div>
      <p className="text-[9px] leading-snug text-neutral-400">
        Soft cap applies only to this bloc. Existing agreements are not cancelled.
      </p>
    </div>
  )
}

function RelationTimeline({ events, limit }) {
  const rows = limit ? events.slice(0, limit) : events
  if (!rows.length) return <EmptyState>// Belum ada event diplomasi</EmptyState>
  return (
    <div className="divide-y divide-carbon-border">
      {rows.map((event) => (
        <div key={event.id} className="px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold text-neutral-200 truncate">
              {eventLabel(event.event_type)}
            </span>
            <span className="text-[9px] text-neutral-400 whitespace-nowrap">
              {formatDateTime(event.created_at)}
            </span>
          </div>
          {event.description ? (
            <p className="mt-0.5 text-[10px] leading-snug text-neutral-400">{event.description}</p>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function BlocCard({ bloc }) {
  return (
    <div className="bg-carbon-surface border border-carbon-border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <BlocBadge bloc={bloc.bloc} />
        <span className="text-[10px] text-neutral-400 uppercase tracking-wider">
          {num(bloc.activeAgencies)} ACTIVE
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div className="border border-carbon-border bg-carbon-bg px-2 py-1.5">
          <div className="text-neutral-400 uppercase tracking-wider text-[9px]">NPC</div>
          <div className="text-neutral-100 font-bold text-sm tabular-nums">{num(bloc.npcAgencies)}</div>
        </div>
        <div className="border border-carbon-border bg-carbon-bg px-2 py-1.5">
          <div className="text-neutral-400 uppercase tracking-wider text-[9px]">Player</div>
          <div className="text-neutral-100 font-bold text-sm tabular-nums">{num(bloc.playerAgencies)}</div>
        </div>
      </div>
    </div>
  )
}

function RelationsOverview({ overview, onOpenTab, onOpenDetail }) {
  const agency = overview.agency
  const saturation = overview.saturation || []
  const relationCounts = overview.relationCounts || {}
  const policy = overview.policy || {}

  return (
    <div className="space-y-4">
      <Panel
        title={`Diplomatic Command // ${agency?.name || 'AGENCY'}`}
        right={overview.gameDate || '—'}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-carbon-border">
          <div className="bg-carbon-surface px-3 py-2">
            <div className="text-[9px] uppercase tracking-wider text-neutral-400">Your Bloc</div>
            <div className="mt-1"><BlocBadge bloc={agency?.bloc} /></div>
          </div>
          <div className="bg-carbon-surface px-3 py-2">
            <div className="text-[9px] uppercase tracking-wider text-neutral-400">Pending Inbox</div>
            <div className="mt-1 text-lg font-bold text-flight-amber tabular-nums">
              {num(overview.proposals?.incomingPending)}
            </div>
          </div>
          <div className="bg-carbon-surface px-3 py-2">
            <div className="text-[9px] uppercase tracking-wider text-neutral-400">Active Agreements</div>
            <div className="mt-1 text-lg font-bold text-telemetry-green tabular-nums">
              {num(overview.agreements?.active)}
            </div>
          </div>
          <div className="bg-carbon-surface px-3 py-2">
            <div className="text-[9px] uppercase tracking-wider text-neutral-400">Relations</div>
            <div className="mt-1 text-lg font-bold text-neutral-100 tabular-nums">
              {num(overview.relations?.length)}
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(overview.blocs || []).map((bloc) => <BlocCard key={bloc.bloc} bloc={bloc} />)}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <Panel
          className="xl:col-span-7"
          title="Bloc Saturation"
          right={agency?.bloc === 'neutral' ? 'NEUTRAL SOFT CAP' : 'NEUTRAL AGENCIES ONLY'}
        >
          <div className="p-3 space-y-4">
            {agency?.bloc === 'neutral' ? (
              saturation.length ? (
                saturation.map((entry) => <SaturationMeter key={entry.bloc} entry={entry} />)
              ) : (
                <EmptyState>// Saturation belum tersedia</EmptyState>
              )
            ) : (
              <div className="text-[10px] leading-relaxed text-neutral-400">
                Saturation hanya membatasi agensi netral terhadap bloc western dan eastern. Bloc Anda
                tetap dapat membuat perjanjian dengan agensi netral selama kapasitas mereka tersedia.
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="border border-carbon-border bg-carbon-bg px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-wider text-neutral-400">Cooperative</div>
                <div className="text-neutral-100 font-bold tabular-nums">
                  {num(relationCounts.cooperative)}
                </div>
              </div>
              <div className="border border-carbon-border bg-carbon-bg px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-wider text-neutral-400">Allied</div>
                <div className="text-neutral-100 font-bold tabular-nums">{num(relationCounts.allied)}</div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel className="xl:col-span-5" title="Agreement Policy" right="SERVER AUTHORITATIVE">
          <div className="p-3 space-y-2 text-[10px]">
            {(policy.agreementTypes || []).map((type) => (
              <div key={type.id} className="border border-carbon-border bg-carbon-bg px-2 py-2 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-neutral-100">{type.label}</span>
                  <Badge tone="active">{formatUsd(type.costFunding)}</Badge>
                </div>
                <div className="text-neutral-400">
                  Counter {formatUsd(type.counterCostFunding)} · Duration{' '}
                  {(type.allowedDurationsGameDays || []).join(' / ')} game days · Relation +
                  {type.relationGain}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2 text-neutral-400">
              <span>Proposal expiry</span>
              <span className="text-neutral-200">{policy.proposalExpiryGameDays} game days</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-neutral-400">
              <span>Pair cooldown</span>
              <span className="text-neutral-200">{policy.cooldownGameDays} game days</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-neutral-400">
              <span>Cross-bloc cooldown</span>
              <span className="text-neutral-200">{policy.crossBloc?.cooldownGameDays} game days</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-neutral-400">
              <span>Pending limits (out / in)</span>
              <span className="text-neutral-200">
                {policy.limits?.maxPendingOutgoingPerAgency} / {policy.limits?.maxPendingIncomingPerAgency}
              </span>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <Panel
          className="xl:col-span-7"
          title="Active Relations"
          right={`${overview.relations?.length || 0} TRACKED`}
        >
          {overview.relations?.length ? (
            <div className="divide-y divide-carbon-border">
              {overview.relations.slice(0, 8).map((relation) => (
                <button
                  key={relation.id}
                  type="button"
                  onClick={() => onOpenDetail(relation.counterpart?.id)}
                  className="w-full text-left px-3 py-2 hover:bg-carbon-container bezier-fast"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[11px] font-bold text-neutral-100 truncate">
                        {relation.counterpart?.name || 'UNKNOWN'}
                      </span>
                      <ControllerBadge agency={relation.counterpart} />
                    </div>
                    <Badge tone={relation.status}>{relation.status}</Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="flex-1 h-1 bg-carbon-bg">
                      <div
                        className="h-full bg-flight-amber"
                        style={{ width: `${Math.min(100, num(relation.relation_score))}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-neutral-300 tabular-nums">
                      {num(relation.relation_score)}/100
                    </span>
                    <span className="text-[9px] text-neutral-400">
                      {num(relation.active_agreements)} agreement(s)
                    </span>
                  </div>
                </button>
              ))}
              {overview.relations.length > 8 ? (
                <button
                  type="button"
                  onClick={() => onOpenTab('agencies')}
                  className="w-full px-3 py-2 text-[10px] uppercase tracking-wider text-flight-amber hover:bg-carbon-container bezier-fast"
                >
                  View all agencies
                </button>
              ) : null}
            </div>
          ) : (
            <EmptyState>// Belum ada relasi. Kirim proposal dari tab Inbox.</EmptyState>
          )}
        </Panel>

        <Panel className="xl:col-span-5" title="Recent Events" right="AUDIT LOG">
          <RelationTimeline events={overview.recentEvents || []} limit={8} />
        </Panel>
      </div>
    </div>
  )
}

function AgencyDirectory({ agencies, counts, filters, onFilterChange, onSelect }) {
  return (
    <Panel title="Agency Directory" right={`${agencies.length} ROWS`}>
      <div className="p-3 border-b border-carbon-border grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="text-[9px] uppercase tracking-wider text-neutral-400">
          Bloc
          <select
            value={filters.bloc}
            onChange={(event) => onFilterChange({ ...filters, bloc: event.target.value })}
            className="mt-1 w-full bg-carbon-bg border border-carbon-border text-neutral-100 text-[11px] px-2 py-1.5"
          >
            <option value="all">All blocs</option>
            <option value="western">Western</option>
            <option value="eastern">Eastern</option>
            <option value="neutral">Neutral</option>
          </select>
        </label>
        <label className="text-[9px] uppercase tracking-wider text-neutral-400">
          Status
          <select
            value={filters.status}
            onChange={(event) => onFilterChange({ ...filters, status: event.target.value })}
            className="mt-1 w-full bg-carbon-bg border border-carbon-border text-neutral-100 text-[11px] px-2 py-1.5"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All status</option>
          </select>
        </label>
        <label className="text-[9px] uppercase tracking-wider text-neutral-400">
          Search
          <input
            value={filters.search}
            onChange={(event) => onFilterChange({ ...filters, search: event.target.value })}
            placeholder="Name, code, country"
            className="mt-1 w-full bg-carbon-bg border border-carbon-border text-neutral-100 text-[11px] px-2 py-1.5 placeholder:text-neutral-500"
          />
        </label>
      </div>

      <div className="px-3 py-2 border-b border-carbon-border flex flex-wrap items-center gap-x-4 gap-y-1 text-[9px] uppercase tracking-wider text-neutral-400">
        <span>Active <b className="text-neutral-100">{num(counts?.active)}</b></span>
        <span>NPC <b className="text-flight-amber">{num(counts?.npc)}</b></span>
        <span>Player <b className="text-telemetry-green">{num(counts?.player)}</b></span>
        <span>Inactive <b className="text-neutral-300">{num(counts?.inactive)}</b></span>
      </div>

      {agencies.length === 0 ? (
        <EmptyState>// Tidak ada agensi yang cocok dengan filter</EmptyState>
      ) : (
        <div className="divide-y divide-carbon-border max-h-[560px] overflow-y-auto custom-scroll">
          {agencies.map((agency) => (
            <button
              key={agency.id}
              type="button"
              onClick={() => onSelect(agency.id)}
              className="w-full text-left px-3 py-2 hover:bg-carbon-container bezier-fast"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold text-neutral-100 truncate">{agency.name}</span>
                <ControllerBadge agency={agency} />
                <BlocBadge bloc={agency.bloc} />
                {!agency.is_active ? <Badge tone="inactive">Inactive</Badge> : null}
                <span className="ml-auto text-[9px] text-neutral-400 whitespace-nowrap">
                  {agency.code || '—'}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] uppercase tracking-wider text-neutral-400">
                <span>{agency.country || 'Unknown country'}</span>
                <span>{agency.alignment || 'No alignment'}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </Panel>
  )
}

function ProposalComposer({
  policy,
  targets,
  targetId,
  duration,
  note,
  preview,
  previewLoading,
  previewError,
  counterProposal,
  busy,
  actionError,
  onChangeTarget,
  onChangeDuration,
  onChangeNote,
  onSubmit,
  onCancelCounter,
}) {
  const cooperation = (policy?.agreementTypes || []).find((type) => type.id === 'cooperation')
  const maxNote = num(policy?.noteMaxLength)
  const noteTooLong = maxNote > 0 && note.length > maxNote
  const counterMode = Boolean(counterProposal)
  const selectedTarget = counterMode ? counterProposal?.counterpart : targets.find((row) => row.id === targetId)
  const saturation = preview?.saturation || []
  const reasons = (preview?.reasons || []).filter((reason) => (
    counterMode ? reason.code === 'WESTERN_SATURATED' || reason.code === 'EASTERN_SATURATED' : true
  ))
  const saturationBlocked = saturation.some((entry) => entry.isSaturated)
  const canSubmit = Boolean(targetId)
    && !busy
    && !saturationBlocked
    && (counterMode || (Boolean(preview?.allowed) && preview?.target?.id === targetId))
    && !noteTooLong

  const displayCost = counterMode && cooperation
    ? Math.round(Number(cooperation.counterCostFunding) * (
      preview?.crossBlocPenalty ? Number(policy?.crossBloc?.costMultiplier || 1) : 1
    ))
    : preview?.costFunding

  return (
    <Panel
      title={counterMode ? `Counter Proposal // ${selectedTarget?.name || 'TARGET'}` : 'Proposal Composer'}
      right={cooperation?.label || 'COOPERATION'}
    >
      <div className="p-3 space-y-3">
        {counterMode ? (
          <div className="border border-flight-amber/40 bg-flight-amber/10 px-2 py-1.5 text-[10px] text-flight-amber flex items-start justify-between gap-2">
            <span>
              Counter replaces the pending proposal with a reverse cooperation proposal. Duration
              follows the original terms: {counterProposal?.terms?.duration_days || '—'} game days.
            </span>
            <button
              type="button"
              onClick={onCancelCounter}
              className="text-[9px] uppercase tracking-wider underline whitespace-nowrap"
            >
              Cancel
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-[9px] uppercase tracking-wider text-neutral-400">
            Target agency
            <select
              value={targetId || ''}
              onChange={(event) => onChangeTarget(event.target.value)}
              disabled={counterMode}
              className="mt-1 w-full bg-carbon-bg border border-carbon-border text-neutral-100 text-[11px] px-2 py-1.5 disabled:opacity-60"
            >
              <option value="">Select agency</option>
              {targets.map((agency) => (
                <option key={agency.id} value={agency.id}>
                  {agency.name} · {agency.bloc} · {agency.controller_type === 'npc' ? 'NPC' : 'PLAYER'}
                </option>
              ))}
            </select>
          </label>

          {counterMode ? (
            <div className="text-[9px] uppercase tracking-wider text-neutral-400">
              Agreement
              <div className="mt-1 border border-carbon-border bg-carbon-bg px-2 py-1.5 text-[11px] text-neutral-100">
                {cooperation?.label || 'Cooperation Agreement'}
              </div>
            </div>
          ) : (
            <div className="text-[9px] uppercase tracking-wider text-neutral-400">
              Duration (game days)
              <div className="mt-1 flex items-center gap-1.5">
                {(cooperation?.allowedDurationsGameDays || []).map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => onChangeDuration(days)}
                    className={`flex-1 border px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider bezier-fast ${
                      Number(duration) === Number(days)
                        ? 'border-flight-amber text-flight-amber bg-flight-amber/10'
                        : 'border-carbon-border text-neutral-300 hover:border-carbon-border-light'
                    }`}
                  >
                    {days}D
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <label className="block text-[9px] uppercase tracking-wider text-neutral-400">
          Note (optional)
          <textarea
            value={note}
            onChange={(event) => onChangeNote(event.target.value)}
            rows={2}
            maxLength={maxNote || undefined}
            placeholder="Short context for the counterpart. No free chat."
            className="mt-1 w-full bg-carbon-bg border border-carbon-border text-neutral-100 text-[11px] px-2 py-1.5 placeholder:text-neutral-500 resize-y"
          />
          {maxNote ? (
            <span className={`mt-1 block text-right text-[9px] ${noteTooLong ? 'text-alert-red' : 'text-neutral-500'}`}>
              {note.length}/{maxNote}
            </span>
          ) : null}
        </label>

        <div className="border border-carbon-border bg-carbon-bg p-2 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] uppercase tracking-wider text-neutral-400">Server preview</span>
            {previewLoading ? (
              <span className="text-[9px] text-flight-amber">CALCULATING...</span>
            ) : preview?.acceptance ? (
              <Badge tone={preview.acceptance === 'high' ? 'active' : preview.acceptance === 'medium' ? 'pending' : 'rejected'}>
                Acceptance {preview.acceptance}
              </Badge>
            ) : (
              <span className="text-[9px] text-neutral-500">—</span>
            )}
          </div>

          {previewError ? (
            <div className="text-[10px] text-alert-red">&gt; {previewError}</div>
          ) : null}

          {preview ? (
            <>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-neutral-400">Cost</div>
                  <div className="text-neutral-100 font-bold">{formatUsd(displayCost)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-neutral-400">Cooldown</div>
                  <div className="text-neutral-100 font-bold">
                    {preview.crossBlocPenalty
                      ? `${policy?.crossBloc?.cooldownGameDays} game days`
                      : `${policy?.cooldownGameDays} game days`}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-neutral-400">Expires</div>
                  <div className="text-neutral-100">{formatDateTime(preview.expiresAt)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-neutral-400">Cross bloc</div>
                  <div className={preview.crossBlocPenalty ? 'text-flight-amber' : 'text-neutral-300'}>
                    {preview.crossBlocPenalty ? 'SOFT PENALTY' : 'NONE'}
                  </div>
                </div>
              </div>

              {saturation.length ? (
                <div className="space-y-1.5">
                  {saturation.map((entry) => (
                    <div key={entry.bloc} className="border border-carbon-border bg-carbon-surface px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <BlocBadge bloc={entry.bloc} />
                        {entry.isSaturated ? (
                          <Badge tone="terminated">{String(entry.bloc).toUpperCase()} SATURATED</Badge>
                        ) : (
                          <span className="text-[9px] uppercase tracking-wider text-neutral-400">
                            {num(entry.counterpartCount)}/{num(entry.blocAgencyCount)} · CAP {num(entry.threshold)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {reasons.length ? (
                <div className="space-y-1">
                  {reasons.map((reason) => (
                    <div key={`${reason.code}-${reason.message}`} className="text-[10px] text-alert-red">
                      &gt; {reason.code}: {reason.message}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[10px] text-telemetry-green">&gt; Server validation passed</div>
              )}

              <div className="text-[9px] uppercase tracking-wider text-neutral-400">
                Pending {num(preview.limits?.outgoingPending)}/{num(preview.limits?.outgoingLimit)} outgoing ·{' '}
                Target inbox {num(preview.limits?.incomingPending)}/{num(preview.limits?.incomingLimit)}
              </div>
            </>
          ) : null}
        </div>

        {actionError ? (
          <div className="border border-alert-red/40 bg-alert-red/10 px-2 py-1.5 text-[10px] text-alert-red">
            &gt; {actionError}
          </div>
        ) : null}

        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="w-full bg-flight-amber hover:bg-flight-amber-dim disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold text-[10px] uppercase tracking-wider px-3 py-2 bezier-fast"
        >
          {busy ? 'Transmitting...' : counterMode ? 'Send Counter Proposal' : 'Send Cooperation Proposal'}
        </button>
        <p className="text-[9px] leading-snug text-neutral-500">
          Funding is charged when the proposal is sent. Acceptance, relation score, and saturation are
          decided by the server.
        </p>
      </div>
    </Panel>
  )
}

function ProposalRow({ proposal, nowTick, busy, onRespond, onWithdraw, onCounter }) {
  const duration = proposal.terms?.duration_days
  const counterpart = proposal.counterpart
  return (
    <div className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={proposal.direction === 'incoming' ? 'pending' : 'withdrawn'}>
          {proposal.direction}
        </Badge>
        <span className="text-[11px] font-bold text-neutral-100 truncate">
          {counterpart?.name || 'UNKNOWN AGENCY'}
        </span>
        <ControllerBadge agency={counterpart} />
        <Badge tone={proposal.status}>{proposal.status}</Badge>
        <span className="ml-auto text-[9px] text-neutral-400 whitespace-nowrap">
          {proposal.can_respond ? 'EXPIRES' : 'ENDED'} {formatCountdown(proposal.expires_at, nowTick)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] uppercase tracking-wider text-neutral-400">
        <span>{titleCase(proposal.proposal_type)}</span>
        {duration ? <span>{duration} game days</span> : null}
        <span>{formatDateTime(proposal.created_at)}</span>
      </div>
      {proposal.note ? (
        <p className="mt-1 text-[10px] leading-snug text-neutral-300 border-l border-carbon-border pl-2">
          {proposal.note}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {proposal.can_respond ? (
          <>
            <button
              type="button"
              onClick={() => onRespond(proposal, 'accept')}
              disabled={busy}
              className="border border-telemetry-green/50 text-telemetry-green hover:bg-telemetry-green/10 disabled:opacity-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wider bezier-fast"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => onRespond(proposal, 'reject')}
              disabled={busy}
              className="border border-alert-red/50 text-alert-red hover:bg-alert-red/10 disabled:opacity-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wider bezier-fast"
            >
              Reject
            </button>
            {proposal.can_counter ? (
              <button
                type="button"
                onClick={() => onCounter(proposal)}
                disabled={busy}
                className="border border-flight-amber/50 text-flight-amber hover:bg-flight-amber/10 disabled:opacity-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wider bezier-fast"
              >
                Counter
              </button>
            ) : null}
          </>
        ) : null}
        {proposal.can_withdraw ? (
          <button
            type="button"
            onClick={() => onWithdraw(proposal)}
            disabled={busy}
            className="border border-carbon-border-light text-neutral-300 hover:border-alert-red/50 hover:text-alert-red disabled:opacity-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wider bezier-fast"
          >
            Withdraw
          </button>
        ) : null}
        {proposal.parent_proposal_id ? (
          <span className="text-[9px] uppercase tracking-wider text-neutral-500">Counter thread</span>
        ) : null}
      </div>
    </div>
  )
}

function ProposalInbox({ proposals, nowTick, busy, onRespond, onWithdraw, onCounter }) {
  const incoming = proposals?.incoming || []
  const outgoing = proposals?.outgoing || []
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      <Panel title="Incoming Proposals" right={`${incoming.length} ITEMS`}>
        {incoming.length ? (
          <div className="divide-y divide-carbon-border max-h-[620px] overflow-y-auto custom-scroll">
            {incoming.map((proposal) => (
              <ProposalRow
                key={proposal.id}
                proposal={proposal}
                nowTick={nowTick}
                busy={busy}
                onRespond={onRespond}
                onWithdraw={onWithdraw}
                onCounter={onCounter}
              />
            ))}
          </div>
        ) : (
          <EmptyState>// Tidak ada proposal masuk</EmptyState>
        )}
      </Panel>

      <Panel title="Outgoing Proposals" right={`${outgoing.length} ITEMS`}>
        {outgoing.length ? (
          <div className="divide-y divide-carbon-border max-h-[620px] overflow-y-auto custom-scroll">
            {outgoing.map((proposal) => (
              <ProposalRow
                key={proposal.id}
                proposal={proposal}
                nowTick={nowTick}
                busy={busy}
                onRespond={onRespond}
                onWithdraw={onWithdraw}
                onCounter={onCounter}
              />
            ))}
          </div>
        ) : (
          <EmptyState>// Belum ada proposal keluar</EmptyState>
        )}
      </Panel>
    </div>
  )
}

function AgreementList({ agreements, nowTick, busy, onTerminate }) {
  const rows = agreements?.agreements || []
  return (
    <Panel title="Cooperation Agreements" right={`${num(agreements?.counts?.active)} ACTIVE`}>
      {rows.length === 0 ? (
        <EmptyState>// Belum ada perjanjian</EmptyState>
      ) : (
        <div className="divide-y divide-carbon-border">
          {rows.map((agreement) => {
            const counterpart = agreement.counterpart
            const active = agreement.status === 'active'
              && agreement.ends_at
              && new Date(agreement.ends_at).getTime() > nowTick
            const effectiveStatus = agreement.status === 'active' && !active ? 'expired' : agreement.status
            return (
              <div key={agreement.id} className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-bold text-neutral-100 truncate">
                    {counterpart?.name || 'UNKNOWN AGENCY'}
                  </span>
                  <ControllerBadge agency={counterpart} />
                  <Badge tone={effectiveStatus}>{effectiveStatus}</Badge>
                  <Badge tone="withdrawn">{agreement.agreement_type}</Badge>
                  <span className="ml-auto text-[9px] text-neutral-400 whitespace-nowrap">
                    {active ? `ENDS ${formatCountdown(agreement.ends_at, nowTick)}` : formatDate(agreement.ends_at)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] uppercase tracking-wider text-neutral-400">
                  <span>{agreement.terms?.duration_days || '—'} game days</span>
                  <span>Started {formatDate(agreement.started_at)}</span>
                  {agreement.terminated_at ? <span>Terminated {formatDate(agreement.terminated_at)}</span> : null}
                </div>
                {active ? (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => onTerminate(agreement)}
                      disabled={busy}
                      className="border border-alert-red/50 text-alert-red hover:bg-alert-red/10 disabled:opacity-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wider bezier-fast"
                    >
                      Terminate Agreement
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

function AgencyDetail({ detail, loading, error, onRetry, onCompose, nowTick }) {
  if (loading) {
    return (
      <Panel title="Relation Detail" right="LOADING">
        <EmptyState>// Memuat relasi...</EmptyState>
      </Panel>
    )
  }
  if (error) {
    return (
      <Panel title="Relation Detail" right="ERROR">
        <div className="px-3 py-4 space-y-3">
          <div className="text-[10px] text-alert-red">&gt; {error}</div>
          <button
            type="button"
            onClick={onRetry}
            className="border border-carbon-border text-neutral-300 hover:text-neutral-100 px-2 py-1 text-[9px] uppercase tracking-wider"
          >
            Retry
          </button>
        </div>
      </Panel>
    )
  }
  if (!detail) {
    return (
      <Panel title="Relation Detail" right="NO SELECTION">
        <EmptyState>// Pilih agensi dari tab Agencies atau Overview</EmptyState>
      </Panel>
    )
  }

  const counterpart = detail.counterpart
  const relation = detail.relation || {}
  const agreements = detail.agreements || []
  const proposals = detail.proposals || []
  const events = detail.events || []

  return (
    <div className="space-y-3">
      <Panel
        title={`Relation // ${counterpart?.name || 'UNKNOWN'}`}
        right={detail.evaluated_at ? formatDateTime(detail.evaluated_at) : '—'}
      >
        <div className="p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <ControllerBadge agency={counterpart} />
            <BlocBadge bloc={counterpart?.bloc} />
            <Badge tone={counterpart?.is_active ? 'active' : 'inactive'}>
              {counterpart?.is_active ? 'Active' : 'Inactive'}
            </Badge>
            <Badge tone={relation.status}>{relation.status || 'neutral'}</Badge>
            <span className="ml-auto text-[9px] uppercase tracking-wider text-neutral-400">
              {counterpart?.code || '—'} · {counterpart?.country || 'Unknown'}
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 text-[10px]">
              <span className="uppercase tracking-wider text-neutral-400">Relation score</span>
              <span className="text-neutral-100 font-bold tabular-nums">
                {num(relation.relation_score)}/100
              </span>
            </div>
            <div className="mt-1 h-2 bg-carbon-bg border border-carbon-border">
              <div
                className="h-full bg-flight-amber"
                style={{ width: `${Math.min(100, num(relation.relation_score))}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
            <div className="border border-carbon-border bg-carbon-bg px-2 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-neutral-400">Active agreements</div>
              <div className="text-neutral-100 font-bold">{num(detail.active_agreements)}</div>
            </div>
            <div className="border border-carbon-border bg-carbon-bg px-2 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-neutral-400">Cooldown</div>
              <div className="text-neutral-100">
                {relation.cooldown_until
                  ? formatCountdown(relation.cooldown_until, nowTick)
                  : 'Ready'}
              </div>
            </div>
            <div className="border border-carbon-border bg-carbon-bg px-2 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-neutral-400">Proposals</div>
              <div className="text-neutral-100 font-bold">{proposals.length}</div>
            </div>
            <div className="border border-carbon-border bg-carbon-bg px-2 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-neutral-400">Last action</div>
              <div className="text-neutral-100">{formatDate(relation.last_action_at)}</div>
            </div>
          </div>

          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => onCompose(counterpart?.id)}
              disabled={!counterpart?.is_active}
              className="border border-flight-amber/50 text-flight-amber hover:bg-flight-amber/10 disabled:opacity-50 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider bezier-fast"
            >
              Compose Proposal
            </button>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <Panel title="Agreement History" right={`${agreements.length} ITEMS`}>
          {agreements.length === 0 ? (
            <EmptyState>// Belum ada perjanjian dengan agensi ini</EmptyState>
          ) : (
            <div className="divide-y divide-carbon-border">
              {agreements.map((agreement) => (
                <div key={agreement.id} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold text-neutral-100">
                      {titleCase(agreement.agreement_type)}
                    </span>
                    <Badge tone={agreement.status}>{agreement.status}</Badge>
                  </div>
                  <div className="mt-0.5 text-[9px] uppercase tracking-wider text-neutral-400">
                    {agreement.terms?.duration_days || '—'} game days · {formatDate(agreement.started_at)} →{' '}
                    {formatDate(agreement.ends_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Proposal History" right={`${proposals.length} ITEMS`}>
          {proposals.length === 0 ? (
            <EmptyState>// Belum ada proposal dengan agensi ini</EmptyState>
          ) : (
            <div className="divide-y divide-carbon-border max-h-[320px] overflow-y-auto custom-scroll">
              {proposals.map((proposal) => (
                <div key={proposal.id} className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={proposal.direction === 'incoming' ? 'pending' : 'withdrawn'}>
                      {proposal.direction}
                    </Badge>
                    <Badge tone={proposal.status}>{proposal.status}</Badge>
                    <span className="text-[9px] uppercase tracking-wider text-neutral-400">
                      {proposal.terms?.duration_days || '—'} game days
                    </span>
                    <span className="ml-auto text-[9px] text-neutral-400">
                      {formatDateTime(proposal.created_at)}
                    </span>
                  </div>
                  {proposal.note ? (
                    <p className="mt-1 text-[10px] text-neutral-400">{proposal.note}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Relation Timeline" right="AUDIT LOG">
        <RelationTimeline events={events} />
      </Panel>
    </div>
  )
}

export default function Relations({
  agencyId,
  agencyName,
  apiRequest,
  onChange,
}) {
  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [overview, setOverview] = useState(null)
  const [directory, setDirectory] = useState(null)
  const [agreements, setAgreements] = useState(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [filters, setFilters] = useState({ bloc: 'all', status: 'active', search: '' })
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [targetId, setTargetId] = useState('')
  const [duration, setDuration] = useState(null)
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [counterProposal, setCounterProposal] = useState(null)
  const [nowTick, setNowTick] = useState(Date.now())

  const policy = overview?.policy || null
  const cooperation = (policy?.agreementTypes || []).find((type) => type.id === 'cooperation')
  const targets = useMemo(
    () => (directory?.agencies || []).filter((agency) => agency.id !== agencyId && agency.is_active),
    [directory, agencyId],
  )

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [])

  const loadOverview = useCallback(async ({ silent = true } = {}) => {
    if (!agencyId) return null
    const data = await apiRequest(`/diplomacy/overview/${agencyId}`)
    setOverview(data)
    return data
  }, [agencyId, apiRequest])

  const loadDirectory = useCallback(async ({ silent = true } = {}) => {
    if (!agencyId) return null
    const data = await apiRequest('/diplomacy/agencies?status=all')
    setDirectory(data)
    return data
  }, [agencyId, apiRequest])

  const loadAgreements = useCallback(async ({ silent = true } = {}) => {
    if (!agencyId) return null
    const data = await apiRequest(`/diplomacy/agreements/${agencyId}`)
    setAgreements(data)
    return data
  }, [agencyId, apiRequest])

  const loadDetail = useCallback(async (counterpartId, { silent = false } = {}) => {
    if (!agencyId || !counterpartId) {
      setDetail(null)
      return null
    }
    if (!silent) setDetailLoading(true)
    setDetailError('')
    try {
      const data = await apiRequest(`/diplomacy/relations/${agencyId}/${counterpartId}`)
      setDetail(data)
      return data
    } catch (err) {
      setDetailError(err.message || 'Relation detail unavailable')
      return null
    } finally {
      if (!silent) setDetailLoading(false)
    }
  }, [agencyId, apiRequest])

  const loadAll = useCallback(async ({ silent = false } = {}) => {
    if (!agencyId) {
      setLoading(false)
      return
    }
    if (!silent) setLoading(true)
    setError('')
    try {
      await Promise.all([
        loadOverview({ silent }),
        loadDirectory({ silent }),
        loadAgreements({ silent }),
      ])
    } catch (err) {
      setError(err.message || 'Diplomacy feed unavailable')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [agencyId, loadAgreements, loadDirectory, loadOverview])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    if (!cooperation || duration) return
    const first = cooperation.allowedDurationsGameDays?.[0]
    if (first) setDuration(first)
  }, [cooperation, duration])

  useEffect(() => {
    if (tab !== 'detail' || !selectedId) return
    loadDetail(selectedId)
  }, [tab, selectedId, loadDetail])

  const previewTarget = counterProposal
    ? counterProposal.counterpart?.id
    : targetId
  const previewDuration = counterProposal
    ? Number(counterProposal.terms?.duration_days)
    : Number(duration)

  useEffect(() => {
    setPreview(null)
    setPreviewError('')
    if (!agencyId || !previewTarget || !previewDuration) {
      setPreviewLoading(false)
      return undefined
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setPreviewLoading(true)
      setPreviewError('')
      try {
        const data = await apiRequest('/diplomacy/proposals/preview', {
          method: 'POST',
          body: JSON.stringify({
            agencyId,
            targetAgencyId: previewTarget,
            agreementType: 'cooperation',
            durationDays: previewDuration,
          }),
        })
        if (!cancelled) setPreview(data)
      } catch (err) {
        if (!cancelled) {
          setPreview(null)
          setPreviewError(err.message || 'Preview failed')
        }
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [agencyId, apiRequest, previewDuration, previewTarget])

  const filteredAgencies = useMemo(() => {
    const search = filters.search.trim().toLowerCase()
    return (directory?.agencies || []).filter((agency) => {
      if (filters.bloc !== 'all' && agency.bloc !== filters.bloc) return false
      if (filters.status === 'active' && !agency.is_active) return false
      if (filters.status === 'inactive' && agency.is_active) return false
      if (search) {
        const haystack = [agency.name, agency.code, agency.country]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(search)) return false
      }
      return true
    })
  }, [directory, filters])

  const refreshAll = useCallback(async () => {
    await Promise.all([
      loadOverview(),
      loadDirectory(),
      loadAgreements(),
    ])
    if (selectedId) await loadDetail(selectedId, { silent: true })
    if (onChange) await onChange()
  }, [loadAgreements, loadDetail, loadDirectory, loadOverview, onChange, selectedId])

  const openDetail = useCallback((counterpartId) => {
    if (!counterpartId) return
    setSelectedId(counterpartId)
    setTab('detail')
    setDetailLoading(true)
    setDetailError('')
  }, [])

  const openComposer = useCallback((counterpartId) => {
    setCounterProposal(null)
    setTargetId(counterpartId || '')
    setNote('')
    setActionError('')
    setPreview(null)
    setPreviewError('')
    setTab('inbox')
  }, [])

  const respond = useCallback(async (proposal, action) => {
    setBusy(true)
    setActionError('')
    try {
      await apiRequest(`/diplomacy/proposals/${proposal.id}/respond`, {
        method: 'POST',
        body: JSON.stringify({ agencyId, action }),
      })
      await refreshAll()
    } catch (err) {
      setActionError(err.message || 'Response failed')
    } finally {
      setBusy(false)
    }
  }, [agencyId, apiRequest, refreshAll])

  const withdraw = useCallback(async (proposal) => {
    if (!window.confirm(`Withdraw proposal to ${proposal.counterpart?.name || 'this agency'}?`)) return
    setBusy(true)
    setActionError('')
    try {
      await apiRequest(`/diplomacy/proposals/${proposal.id}/withdraw`, {
        method: 'POST',
        body: JSON.stringify({ agencyId }),
      })
      await refreshAll()
    } catch (err) {
      setActionError(err.message || 'Withdraw failed')
    } finally {
      setBusy(false)
    }
  }, [agencyId, apiRequest, refreshAll])

  const startCounter = useCallback((proposal) => {
    setCounterProposal(proposal)
    setTargetId(proposal.counterpart?.id || '')
    setNote('')
    setActionError('')
    setPreview(null)
    setPreviewError('')
    setTab('inbox')
  }, [])

  const submitProposal = useCallback(async () => {
    if (!targetId || !previewDuration) return
    setBusy(true)
    setActionError('')
    try {
      if (counterProposal) {
        await apiRequest(`/diplomacy/proposals/${counterProposal.id}/respond`, {
          method: 'POST',
          body: JSON.stringify({ agencyId, action: 'counter', note }),
        })
      } else {
        await apiRequest('/diplomacy/proposals', {
          method: 'POST',
          body: JSON.stringify({
            agencyId,
            targetAgencyId: targetId,
            agreementType: 'cooperation',
            durationDays: duration,
            note,
          }),
        })
      }
      setNote('')
      setCounterProposal(null)
      setTargetId('')
      setPreview(null)
      await refreshAll()
    } catch (err) {
      setActionError(err.message || 'Proposal failed')
    } finally {
      setBusy(false)
    }
  }, [agencyId, apiRequest, counterProposal, duration, note, previewDuration, refreshAll, targetId])

  const terminate = useCallback(async (agreement) => {
    if (!window.confirm(`Terminate cooperation agreement with ${agreement.counterpart?.name || 'this agency'}? This applies a relation penalty.`)) {
      return
    }
    setBusy(true)
    setActionError('')
    try {
      await apiRequest(`/diplomacy/agreements/${agreement.id}/terminate`, {
        method: 'POST',
        body: JSON.stringify({ agencyId }),
      })
      await refreshAll()
    } catch (err) {
      setActionError(err.message || 'Termination failed')
    } finally {
      setBusy(false)
    }
  }, [agencyId, apiRequest, refreshAll])

  if (!agencyId) {
    return (
      <Panel title="Relations // Diplomacy" right="NO AGENCY">
        <EmptyState>// Agensi belum terhubung ke MCC</EmptyState>
      </Panel>
    )
  }

  if (loading) {
    return (
      <Panel title={`Relations // ${agencyName || 'AGENCY'}`} right="SYNCING">
        <EmptyState>// Menghubungkan diplomatic channel...</EmptyState>
      </Panel>
    )
  }

  if (error) {
    return (
      <Panel title="Relations // Diplomacy" right="ERROR">
        <div className="px-3 py-4 space-y-3">
          <div className="text-[10px] text-alert-red">&gt; {error}</div>
          <button
            type="button"
            onClick={() => loadAll()}
            className="border border-carbon-border text-neutral-300 hover:text-neutral-100 px-2 py-1 text-[9px] uppercase tracking-wider"
          >
            Retry
          </button>
        </div>
      </Panel>
    )
  }

  return (
    <div className="space-y-3">
      <div className="bg-carbon-surface border border-carbon-border">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-carbon-border overflow-x-auto custom-scroll">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              aria-current={tab === entry.id ? 'page' : undefined}
              className={`px-2.5 py-1.5 text-[10px] uppercase tracking-wider border-b-2 whitespace-nowrap bezier-fast ${
                tab === entry.id
                  ? 'border-flight-amber text-flight-amber font-bold'
                  : 'border-transparent text-neutral-400 hover:text-neutral-100'
              }`}
            >
              {entry.label}
            </button>
          ))}
          <span className="ml-auto text-[9px] uppercase tracking-wider text-neutral-500 whitespace-nowrap">
            {overview?.gameDate || '—'}
          </span>
        </div>
        {actionError ? (
          <div className="px-3 py-2 border-b border-alert-red/40 bg-alert-red/10 text-[10px] text-alert-red">
            &gt; {actionError}
          </div>
        ) : null}
      </div>

      {tab === 'overview' && overview ? (
        <RelationsOverview
          overview={overview}
          onOpenTab={setTab}
          onOpenDetail={openDetail}
        />
      ) : null}

      {tab === 'agencies' ? (
        <AgencyDirectory
          agencies={filteredAgencies}
          counts={directory?.counts}
          filters={filters}
          onFilterChange={setFilters}
          onSelect={openDetail}
        />
      ) : null}

      {tab === 'inbox' ? (
        <div className="space-y-3">
          <ProposalComposer
            policy={policy}
            targets={targets}
            targetId={targetId}
            duration={duration}
            note={note}
            preview={preview}
            previewLoading={previewLoading}
            previewError={previewError}
            counterProposal={counterProposal}
            busy={busy}
            actionError={actionError}
            onChangeTarget={(value) => {
              setCounterProposal(null)
              setTargetId(value)
              setPreview(null)
              setPreviewError('')
            }}
            onChangeDuration={(days) => {
              setDuration(days)
              setPreview(null)
              setPreviewError('')
            }}
            onChangeNote={setNote}
            onSubmit={submitProposal}
            onCancelCounter={() => {
              setCounterProposal(null)
              setTargetId('')
              setNote('')
              setPreview(null)
              setPreviewError('')
            }}
          />
          <ProposalInbox
            proposals={overview?.proposals}
            nowTick={nowTick}
            busy={busy}
            onRespond={respond}
            onWithdraw={withdraw}
            onCounter={startCounter}
          />
        </div>
      ) : null}

      {tab === 'agreements' ? (
        <AgreementList
          agreements={agreements}
          nowTick={nowTick}
          busy={busy}
          onTerminate={terminate}
        />
      ) : null}

      {tab === 'detail' ? (
        <AgencyDetail
          detail={detail}
          loading={detailLoading}
          error={detailError}
          onRetry={() => loadDetail(selectedId)}
          onCompose={openComposer}
          nowTick={nowTick}
        />
      ) : null}
    </div>
  )
}
