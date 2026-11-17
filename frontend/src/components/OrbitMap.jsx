import { useMemo } from 'react'
import { feature } from 'topojson-client'
import landTopology from 'world-atlas/land-110m.json'

const WIDTH = 720
const HEIGHT = 360

const land = feature(landTopology, landTopology.objects.land)

function project(lat, lon) {
  return [
    ((Number(lon) + 180) / 360) * WIDTH,
    ((90 - Number(lat)) / 180) * HEIGHT,
  ]
}

function landPath() {
  const polygons = []
  for (const geometry of land.features) {
    const rings = geometry.geometry.type === 'Polygon'
      ? [geometry.geometry.coordinates]
      : geometry.geometry.coordinates

    for (const polygon of rings) {
      const path = polygon
        .map((ring) => ring
          .map(([lon, lat], index) => {
            const [x, y] = project(lat, lon)
            return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
          })
          .join(' '))
        .join(' ')
      if (path) polygons.push(`${path} Z`)
    }
  }
  return polygons.join(' ')
}

function splitTrack(points) {
  const segments = []
  let current = []
  for (const point of points || []) {
    if (point.break) {
      if (current.length > 1) segments.push(current)
      current = []
      continue
    }
    current.push(point)
  }
  if (current.length > 1) segments.push(current)
  return segments
}

function polylinePoints(points) {
  return points.map((point) => project(point.lat, point.lon).map((value) => value.toFixed(1)).join(',')).join(' ')
}

function circleRadius(station, mission) {
  const link = mission?.link?.stations?.find((item) => item.code === station.code)
  return Number(link?.visibility_radius_deg ?? station.visibility_radius_deg ?? 0)
}

export default function OrbitMap({ overview, mission }) {
  const landOutline = useMemo(landPath, [])
  const activeMission = mission || overview?.missions?.[0] || null
  const stations = overview?.stations || []
  const latLines = []
  const lonLines = []

  for (let lat = -75; lat <= 75; lat += 15) latLines.push(lat)
  for (let lon = -180; lon <= 180; lon += 15) lonLines.push(lon)

  if (!overview) {
    return (
      <div className="flex h-[280px] items-center justify-center border border-carbon-border bg-carbon-bg text-[10px] uppercase tracking-widest text-neutral-400">
        // Menunggu data tracking ground segment
      </div>
    )
  }

  const current = activeMission?.current
  const launchSite = activeMission?.launch_site || overview.agency?.launch_site
  const visibleCodes = new Set(
    (activeMission?.link?.stations || []).filter((link) => link.visible).map((link) => link.code),
  )

  return (
    <div className="border border-carbon-border bg-carbon-bg">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block h-auto w-full"
        role="img"
        aria-label="Peta ground track orbit equirectangular"
      >
        <rect width={WIDTH} height={HEIGHT} fill="#09090B" />

        {latLines.map((lat) => {
          const [, y] = project(lat, 0)
          return <line key={`lat-${lat}`} x1="0" y1={y} x2={WIDTH} y2={y} stroke="#27272A" strokeWidth="0.6" />
        })}
        {lonLines.map((lon) => {
          const [x] = project(0, lon)
          return <line key={`lon-${lon}`} x1={x} y1="0" x2={x} y2={HEIGHT} stroke="#27272A" strokeWidth="0.6" />
        })}

        <path d={landOutline} fill="#18181B" stroke="#3F3F46" strokeWidth="0.8" strokeLinejoin="round" />

        {stations.map((station) => {
          const [x, y] = project(station.lat, station.lon)
          const radius = circleRadius(station, activeMission)
          const rx = Math.min(220, radius / Math.max(0.15, Math.cos((station.lat * Math.PI) / 180))) / 360 * WIDTH
          const ry = radius / 180 * HEIGHT
          const acquired = visibleCodes.has(station.code)

          return (
            <g key={station.code}>
              <ellipse
                cx={x}
                cy={y}
                rx={Math.max(3, rx)}
                ry={Math.max(3, ry)}
                fill="none"
                stroke={acquired ? '#10B981' : '#52525B'}
                strokeWidth="0.8"
                strokeDasharray="3 3"
              />
              <rect
                x={x - 2}
                y={y - 2}
                width="4"
                height="4"
                fill={acquired ? '#10B981' : '#71717A'}
              />
              <title>{`${station.name} // ${acquired ? 'ACQUIRED' : 'IDLE'}`}</title>
            </g>
          )
        })}

        {activeMission?.drop_zones?.map((zone) => {
          const [x, y] = project(zone.lat, zone.lon)
          return (
            <ellipse
              key={zone.label}
              cx={x}
              cy={y}
              rx={Math.max(4, (zone.radius_lon_deg / 360) * WIDTH)}
              ry={Math.max(3, (zone.radius_lat_deg / 180) * HEIGHT)}
              fill="#D97706"
              fillOpacity="0.05"
              stroke="#D97706"
              strokeWidth="0.8"
              strokeDasharray="4 4"
            />
          )
        })}

        {splitTrack(activeMission?.trajectory).map((segment, index) => (
          <polyline
            key={`trajectory-${index}`}
            points={polylinePoints(segment)}
            fill="none"
            stroke="#D97706"
            strokeWidth="1.2"
            strokeDasharray="4 4"
          />
        ))}

        {splitTrack(activeMission?.history).map((segment, index) => (
          <polyline
            key={`history-${index}`}
            points={polylinePoints(segment)}
            fill="none"
            stroke="#D97706"
            strokeWidth="1.5"
          />
        ))}

        {splitTrack(activeMission?.predicted).map((segment, index) => (
          <polyline
            key={`predicted-${index}`}
            points={polylinePoints(segment)}
            fill="none"
            stroke="#A1A1AA"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
        ))}

        {launchSite && (
          <g>
            {(() => {
              const [x, y] = project(launchSite.lat, launchSite.lon)
              return (
                <>
                  <line x1={x - 5} y1={y} x2={x + 5} y2={y} stroke="#D97706" strokeWidth="1" />
                  <line x1={x} y1={y - 5} x2={x} y2={y + 5} stroke="#D97706" strokeWidth="1" />
                  <circle cx={x} cy={y} r="3" fill="none" stroke="#D97706" strokeWidth="1" />
                  <text x={x + 7} y={y - 4} fill="#A1A1AA" fontSize="7" fontFamily="IBM Plex Mono, monospace">
                    PAD
                  </text>
                </>
              )
            })()}
          </g>
        )}

        {current && (() => {
          const [x, y] = project(current.lat, current.lon)
          return (
            <g>
              <circle cx={x} cy={y} r="5" fill="none" stroke="#D97706" strokeWidth="1" opacity="0.6" />
              <rect x={x - 2.5} y={y - 2.5} width="5" height="5" fill="#D97706" />
              <title>{`SAT ${current.lat.toFixed(2)} / ${current.lon.toFixed(2)}`}</title>
            </g>
          )
        })()}

        <text x="8" y="14" fill="#71717A" fontSize="7" fontFamily="IBM Plex Mono, monospace">
          EQUIRECTANGULAR // GROUND TRACK
        </text>
        <text x={WIDTH - 8} y="14" textAnchor="end" fill="#71717A" fontSize="7" fontFamily="IBM Plex Mono, monospace">
          {overview.now ? overview.now.slice(11, 19) : '--:--:--'}Z
        </text>
      </svg>
    </div>
  )
}
