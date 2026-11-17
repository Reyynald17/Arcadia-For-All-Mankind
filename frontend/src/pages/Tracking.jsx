import { useEffect, useMemo, useState } from 'react'
import OrbitMap from '../components/OrbitMap'
import LaunchGlobe from '../components/LaunchGlobe'

function fmt(value, digits = 1) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '—'
}

function InfoRow({ label, value, tone = 'text-neutral-100' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-carbon-border py-1 last:border-b-0">
      <span className="text-[9px] uppercase tracking-wider text-neutral-400">{label}</span>
      <span className={`text-right text-[10px] tabular-nums ${tone}`}>{value}</span>
    </div>
  )
}

function PanelHead({ title, right }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-carbon-border px-3 py-2">
      <h2 className="truncate font-headline text-[11px] font-bold uppercase tracking-widest text-neutral-200">
        {title}
      </h2>
      <span className="whitespace-nowrap text-[9px] text-neutral-400">{right}</span>
    </div>
  )
}

export default function Tracking({ overview, loading, error, onRefresh, agencyName }) {
  const missions = overview?.missions || []
  const [selectedId, setSelectedId] = useState(null)
  const [view, setView] = useState('map')

  useEffect(() => {
    if (missions.length === 0) {
      setSelectedId(null)
      return
    }
    if (!missions.some((mission) => mission.id === selectedId)) {
      setSelectedId(missions[0].id)
    }
  }, [missions, selectedId])

  const selected = useMemo(
    () => missions.find((mission) => mission.id === selectedId) || missions[0] || null,
    [missions, selectedId],
  )

  const orbit = selected?.orbit
  const current = selected?.current
  const link = selected?.link
  const visibleStations = (link?.stations || []).filter((station) => station.visible)

  return (
    <div className="space-y-4">
      <section className="flex flex-col gap-2 border-b border-carbon-border pb-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[9px] uppercase tracking-widest text-neutral-400">
            Ground Segment // {String(agencyName || 'AGENSI').toUpperCase()}
          </div>
          <h1 className="font-headline text-base font-bold uppercase tracking-tight text-neutral-100">
            Orbital Tracking
          </h1>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="flex border border-carbon-border">
            {[
              { id: 'map', label: '2D Map' },
              { id: 'globe', label: '3D Globe' },
            ].map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setView(entry.id)}
                aria-pressed={view === entry.id}
                className={`px-2 py-1 text-[9px] font-bold uppercase tracking-wider bezier-fast ${
                  view === entry.id
                    ? 'bg-flight-amber/10 text-flight-amber'
                    : 'text-neutral-400 hover:text-neutral-100'
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="border border-carbon-border px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-neutral-300 bezier-fast hover:border-flight-amber/50 hover:text-flight-amber disabled:cursor-wait disabled:opacity-50"
          >
            {loading ? 'Sync...' : 'Refresh'}
          </button>
        </div>
      </section>

      {error && (
        <div className="border border-alert-red/40 bg-alert-red/10 px-3 py-2 text-[9px] uppercase tracking-wider text-alert-red">
          // Orbit feed: {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <section className="bg-carbon-surface xl:col-span-8">
          <PanelHead
            title={view === 'map' ? 'Ground Track // Equirectangular' : 'Orbital View // 3D Globe'}
            right={selected ? `${selected.name} // ${selected.status}` : 'NO ACTIVE MISSION'}
          />
          <div className="p-2">
            {view === 'map' ? (
              <OrbitMap overview={overview} mission={selected} />
            ) : (
              <div className="relative aspect-[16/9] w-full overflow-hidden border border-carbon-border bg-carbon-bg">
                <LaunchGlobe overview={overview} mission={selected} />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-carbon-border px-3 py-1.5 text-[8px] uppercase tracking-wider text-neutral-400">
            {view === 'map' ? (
              <>
                <span className="flex items-center gap-1">
                  <span className="h-px w-4 bg-flight-amber" /> Current orbit
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-px w-4 border-t border-dashed border-neutral-400" /> Predicted +2 rev
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-px w-4 border-t border-dashed border-telemetry-green" /> Station LOS
                </span>
              </>
            ) : (
              <>
                <span className="flex items-center gap-1">
                  <span className="h-px w-4 bg-flight-amber" /> Orbit track at altitude
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-px w-4 border-t border-dashed border-neutral-400" /> Predicted +2 rev
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-px w-4 border-t border-dashed border-flight-amber" /> Launch trajectory (ground projection)
                </span>
              </>
            )}
          </div>
        </section>

        <aside className="space-y-4 xl:col-span-4">
          <section className="bg-carbon-surface">
            <PanelHead title="Mission Track" right={`${missions.length} TRACKED`} />
            {missions.length === 0 ? (
              <div className="px-3 py-6 text-center text-[10px] uppercase text-neutral-400">
                Belum ada misi aktif
              </div>
            ) : (
              <div className="divide-y divide-carbon-border">
                {missions.map((mission) => (
                  <button
                    key={mission.id}
                    type="button"
                    onClick={() => setSelectedId(mission.id)}
                    aria-pressed={mission.id === selected?.id}
                    className={`flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left bezier-fast ${
                      mission.id === selected?.id
                        ? 'bg-flight-amber/10 text-flight-amber'
                        : 'text-neutral-300 hover:bg-carbon-bg'
                    }`}
                  >
                    <span className="truncate text-[10px] font-bold uppercase">{mission.name}</span>
                    <span className="whitespace-nowrap text-[9px] uppercase text-neutral-400">
                      {mission.status} // {mission.link?.status || 'NO SIGNAL'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="bg-carbon-surface">
            <PanelHead
              title="Telemetry"
              right={link?.status || (selected?.status ? 'PRE-ORBIT' : 'IDLE')}
            />
            <div className="px-3 py-2">
              {!selected ? (
                <p className="py-4 text-center text-[9px] uppercase text-neutral-400">
                  Tidak ada data telemetri
                </p>
              ) : (
                <div className="space-y-0.5">
                  <InfoRow label="STATUS" value={selected.status} />
                  {orbit ? (
                    <>
                      <InfoRow label="ALTITUDE" value={`${fmt(orbit.altitude_km, 0)} KM`} />
                      <InfoRow label="INCLINATION" value={`${fmt(orbit.inclination_deg)} DEG`} />
                      <InfoRow label="PERIOD" value={`${fmt(orbit.period_seconds / 60, 1)} MIN`} />
                      <InfoRow label="RAAN" value={`${fmt(orbit.raan_deg)} DEG`} />
                      <InfoRow label="ARG LAT" value={`${fmt(orbit.argument_of_latitude_deg)} DEG`} />
                      <InfoRow
                        label="SUB-SAT"
                        value={current ? `${fmt(current.lat, 2)} / ${fmt(current.lon, 2)}` : '—'}
                      />
                      <InfoRow
                        label="UPLINK"
                        value={link?.status || 'NO SIGNAL'}
                        tone={link?.status === 'ACQUIRED' ? 'text-telemetry-green' : 'text-flight-amber'}
                      />
                    </>
                  ) : (
                    <>
                      <InfoRow label="TARGET INC" value={`${fmt(selected.target_inclination_deg)} DEG`} />
                      <InfoRow label="AZIMUTH" value={`${fmt(selected.azimuth_deg)} DEG`} />
                      <InfoRow
                        label="PAD"
                        value={`${fmt(selected.launch_site?.lat, 2)} / ${fmt(selected.launch_site?.lon, 2)}`}
                      />
                      <InfoRow
                        label="LAUNCH WINDOW"
                        value={selected.scheduled_launch_at
                          ? new Date(selected.scheduled_launch_at).toISOString().slice(11, 16) + 'Z'
                          : '—'}
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="bg-carbon-surface">
            <PanelHead
              title="Ground Link"
              right={`${visibleStations.length}/${(link?.stations || []).length} VISIBLE`}
            />
            <div className="max-h-[170px] divide-y divide-carbon-border overflow-y-auto custom-scroll">
              {(link?.stations || []).length === 0 ? (
                <div className="px-3 py-4 text-center text-[9px] uppercase text-neutral-400">
                  {orbit ? 'Agen bergerak di blind spot' : 'Menunggu orbit'}
                </div>
              ) : (
                (link?.stations || []).slice(0, 6).map((station) => (
                  <div key={station.code} className="flex items-baseline justify-between gap-2 px-3 py-1.5">
                    <span className="truncate text-[9px] uppercase text-neutral-300">{station.name}</span>
                    <span
                      className={`whitespace-nowrap text-[8px] font-bold uppercase ${
                        station.visible ? 'text-telemetry-green' : 'text-neutral-400'
                      }`}
                    >
                      {station.visible ? 'ACQUIRED' : 'IDLE'} // {fmt(station.central_angle_deg, 1)}°
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
