import { useEffect, useMemo, useRef, useState } from 'react'
import { feature } from 'topojson-client'
import landTopology from 'world-atlas/land-110m.json'

const VIEW_WIDTH = 640
const VIEW_HEIGHT = 360
const CENTER_X = VIEW_WIDTH / 2
const CENTER_Y = VIEW_HEIGHT / 2
const GLOBE_RADIUS = 138
const MIN_ZOOM = 0.7
const MAX_ZOOM = 3
const MAX_TILT = 75
const EARTH_RADIUS_KM = 6371
const MU_KM3_S2 = 398600.4418

const land = feature(landTopology, landTopology.objects.land)
const landRings = []

for (const item of land.features) {
  const geometry = item.geometry
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  for (const polygon of polygons) {
    for (const ring of polygon) landRings.push(ring)
  }
}

function toRadians(value) {
  return (Number(value) * Math.PI) / 180
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function wrapLon(degrees) {
  let value = Number(degrees) % 360
  if (value > 180) value -= 360
  if (value < -180) value += 360
  return value
}

function defaultCenter(mission, launchSite) {
  const current = mission?.current
  if (current) {
    return {
      lat: clamp(Number(current.lat) * 0.35, -25, 25),
      lon: wrapLon(Number(current.lon) || 0),
    }
  }
  return {
    lat: clamp((Number(launchSite?.lat) || 0) * 0.5, -10, 25),
    lon: wrapLon(Number(launchSite?.lon) || 0),
  }
}

function project(lat, lon, centerLat, centerLon, radiusFactor = 1, globeRadius = GLOBE_RADIUS) {
  const phi = toRadians(lat)
  const lambda = toRadians(Number(lon) - centerLon)
  const cosPhi = Math.cos(phi)
  const x = radiusFactor * cosPhi * Math.sin(lambda)
  const y = radiusFactor * Math.sin(phi)
  const z = radiusFactor * cosPhi * Math.cos(lambda)
  const tilt = toRadians(centerLat)

  const rotatedY = y * Math.cos(tilt) - z * Math.sin(tilt)
  const rotatedZ = y * Math.sin(tilt) + z * Math.cos(tilt)
  const distanceSquared = x * x + rotatedY * rotatedY

  return {
    x: CENTER_X + x * globeRadius,
    y: CENTER_Y - rotatedY * globeRadius,
    // Objects above the surface stay visible while outside Earth's limb.
    visible: rotatedZ > 0.02 || (radiusFactor > 1 && distanceSquared > 1),
  }
}

function strokeRing(ctx, ring, centerLat, centerLon, globeRadius, radiusFactor = 1, fill = null) {
  ctx.beginPath()
  let pen = false
  for (const [lon, lat] of ring) {
    const point = project(lat, lon, centerLat, centerLon, radiusFactor, globeRadius)
    if (!point.visible) {
      pen = false
      continue
    }
    if (!pen) {
      ctx.moveTo(point.x, point.y)
      pen = true
    } else {
      ctx.lineTo(point.x, point.y)
    }
  }
  if (fill) {
    ctx.fillStyle = fill
    ctx.fill()
  }
  ctx.stroke()
}

function strokeGraticule(ctx, centerLat, centerLon, globeRadius) {
  ctx.strokeStyle = '#27272A'
  ctx.lineWidth = 0.6
  ctx.setLineDash([])

  for (let lat = -75; lat <= 75; lat += 15) {
    ctx.beginPath()
    let pen = false
    for (let lon = -180; lon <= 180; lon += 4) {
      const point = project(lat, lon, centerLat, centerLon, 1, globeRadius)
      if (!point.visible) {
        pen = false
        continue
      }
      if (!pen) {
        ctx.moveTo(point.x, point.y)
        pen = true
      } else {
        ctx.lineTo(point.x, point.y)
      }
    }
    ctx.stroke()
  }

  for (let lon = -180; lon < 180; lon += 15) {
    ctx.beginPath()
    let pen = false
    for (let lat = -90; lat <= 90; lat += 4) {
      const point = project(lat, lon, centerLat, centerLon, 1, globeRadius)
      if (!point.visible) {
        pen = false
        continue
      }
      if (!pen) {
        ctx.moveTo(point.x, point.y)
        pen = true
      } else {
        ctx.lineTo(point.x, point.y)
      }
    }
    ctx.stroke()
  }
}

function strokeTrack(ctx, points, centerLat, centerLon, globeRadius, radiusFactor, color, dash = []) {
  if (!points || points.length < 2) return
  ctx.strokeStyle = color
  ctx.lineWidth = dash.length ? 1 : 1.4
  ctx.setLineDash(dash)
  ctx.beginPath()
  let pen = false

  for (const point of points) {
    if (point.break) {
      pen = false
      continue
    }
    const projected = project(
      point.lat,
      point.lon,
      centerLat,
      centerLon,
      radiusFactor,
      globeRadius,
    )
    if (!projected.visible) {
      pen = false
      continue
    }
    if (!pen) {
      ctx.moveTo(projected.x, projected.y)
      pen = true
    } else {
      ctx.lineTo(projected.x, projected.y)
    }
  }
  ctx.stroke()
  ctx.setLineDash([])
}

export default function LaunchGlobe({ overview, mission }) {
  const canvasRef = useRef(null)
  const activeMission = mission || overview?.missions?.[0] || null
  const launchSite = activeMission?.launch_site || overview?.agency?.launch_site
  const orbit = activeMission?.orbit
  const current = activeMission?.current
  const [camera, setCamera] = useState({ lat: 0, lon: 0, zoom: 1, follow: true })
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const pointersRef = useRef(new Map())
  const dragRef = useRef(null)
  const pinchRef = useRef(null)

  const alpha = useMemo(() => {
    if (!orbit) return ''
    const velocity = Math.sqrt(MU_KM3_S2 / (EARTH_RADIUS_KM + orbit.altitude_km))
    return velocity.toFixed(2)
  }, [orbit])

  useEffect(() => {
    setCamera((previous) => ({ ...previous, lat: 0, lon: 0, zoom: 1, follow: true }))
  }, [activeMission?.id])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    const handleWheel = (event) => {
      event.preventDefault()
      const factor = Math.exp(-event.deltaY * 0.0015)
      setCamera((previous) => ({
        ...previous,
        zoom: clamp(previous.zoom * factor, MIN_ZOOM, MAX_ZOOM),
      }))
    }

    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = VIEW_WIDTH * dpr
    canvas.height = VIEW_HEIGHT * dpr
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT)

    const view = camera.follow ? defaultCenter(activeMission, launchSite) : camera
    const centerLon = view.lon
    const centerLat = view.lat
    const zoom = camera.zoom
    const globeRadius = GLOBE_RADIUS * zoom

    ctx.fillStyle = '#09090B'
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT)

    ctx.beginPath()
    ctx.arc(CENTER_X, CENTER_Y, globeRadius, 0, Math.PI * 2)
    ctx.fillStyle = '#0B0B0D'
    ctx.fill()
    ctx.strokeStyle = '#3F3F46'
    ctx.lineWidth = 1
    ctx.stroke()

    strokeGraticule(ctx, centerLat, centerLon, globeRadius)

    ctx.strokeStyle = '#3F3F46'
    ctx.lineWidth = 0.7
    for (const ring of landRings) {
      strokeRing(ctx, ring, centerLat, centerLon, globeRadius, 1, '#18181B')
    }

    const orbitRadiusFactor = orbit ? 1 + Number(orbit.altitude_km || 0) / EARTH_RADIUS_KM : 1
    strokeTrack(ctx, activeMission?.trajectory, centerLat, centerLon, globeRadius, 1, '#D97706', [3, 3])
    strokeTrack(
      ctx,
      activeMission?.history,
      centerLat,
      centerLon,
      globeRadius,
      orbitRadiusFactor,
      '#D97706',
    )
    strokeTrack(
      ctx,
      activeMission?.predicted,
      centerLat,
      centerLon,
      globeRadius,
      orbitRadiusFactor,
      '#A1A1AA',
      [4, 4],
    )

    for (const station of overview?.stations || []) {
      const point = project(station.lat, station.lon, centerLat, centerLon, 1, globeRadius)
      if (!point.visible) continue
      const acquired = activeMission?.link?.stations?.find(
        (link) => link.code === station.code && link.visible,
      )
      ctx.fillStyle = acquired ? '#10B981' : '#71717A'
      ctx.fillRect(point.x - 1.5, point.y - 1.5, 3, 3)
    }

    if (launchSite) {
      const point = project(launchSite.lat, launchSite.lon, centerLat, centerLon, 1, globeRadius)
      if (point.visible) {
        ctx.strokeStyle = '#D97706'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(point.x - 5, point.y)
        ctx.lineTo(point.x + 5, point.y)
        ctx.moveTo(point.x, point.y - 5)
        ctx.lineTo(point.x, point.y + 5)
        ctx.stroke()
      }
    }

    if (current) {
      const point = project(
        current.lat,
        current.lon,
        centerLat,
        centerLon,
        orbitRadiusFactor,
        globeRadius,
      )
      if (point.visible) {
        ctx.fillStyle = '#D97706'
        ctx.fillRect(point.x - 2.5, point.y - 2.5, 5, 5)
        ctx.strokeStyle = '#D97706'
        ctx.beginPath()
        ctx.arc(point.x, point.y, 6, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    ctx.fillStyle = '#A1A1AA'
    ctx.font = '9px "IBM Plex Mono", monospace'
    ctx.fillText(`ALT ${orbit ? `${Math.round(orbit.altitude_km)} KM` : '—'}`, 12, 20)
    ctx.fillText(`VEL ${alpha ? `${alpha} KM/S` : '—'}`, 12, 34)
    ctx.fillText(`INC ${orbit ? `${Number(orbit.inclination_deg).toFixed(1)} DEG` : '—'}`, 12, 48)
    ctx.fillText(
      `LINK ${activeMission?.link?.status || (activeMission?.status ? activeMission.status : 'STANDBY')}`,
      12,
      62,
    )
    if (!orbit && activeMission?.trajectory?.length) {
      ctx.fillText('TRAJECTORY // GROUND PROJECTION (PRE-ORBIT)', 12, 76)
    }
    ctx.fillStyle = '#52525B'
    ctx.fillText('ORTHOGRAPHIC // 3D · DRAG / WHEEL / PINCH', 12, VIEW_HEIGHT - 12)
    ctx.textAlign = 'right'
    const latLabel = `${Math.abs(centerLat).toFixed(1)}${centerLat < 0 ? 'S' : 'N'}`
    const lonLabel = `${Math.abs(centerLon).toFixed(1)}${centerLon < 0 ? 'W' : 'E'}`
    ctx.fillText(
      `${zoom.toFixed(1)}x // ${latLabel} ${lonLabel}`,
      VIEW_WIDTH - 12,
      VIEW_HEIGHT - 12,
    )
    ctx.textAlign = 'left'
  }, [activeMission, alpha, camera, current, launchSite, orbit, overview])

  function beginPan(pointerId, x, y) {
    const base = cameraRef.current.follow
      ? defaultCenter(activeMission, launchSite)
      : { lat: cameraRef.current.lat, lon: cameraRef.current.lon }
    dragRef.current = {
      pointerId,
      startX: x,
      startY: y,
      lat: base.lat,
      lon: base.lon,
      zoom: cameraRef.current.zoom,
    }
  }

  function handlePointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // Synthetic or already-released pointers cannot be captured.
    }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointersRef.current.size === 1) {
      beginPan(event.pointerId, event.clientX, event.clientY)
    } else if (pointersRef.current.size === 2) {
      dragRef.current = null
      const [a, b] = [...pointersRef.current.values()]
      pinchRef.current = {
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        zoom: cameraRef.current.zoom,
      }
    }
  }

  function handlePointerMove(event) {
    const pointers = pointersRef.current
    if (!pointers.has(event.pointerId)) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointers.size >= 2 && pinchRef.current) {
      const [a, b] = [...pointers.values()]
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
      const nextZoom = pinchRef.current.zoom * (distance / pinchRef.current.distance)
      setCamera((previous) => ({
        ...previous,
        zoom: clamp(nextZoom, MIN_ZOOM, MAX_ZOOM),
      }))
      return
    }

    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    const degreesPerPixel = 180 / (Math.PI * GLOBE_RADIUS * drag.zoom)
    setCamera((previous) => ({
      ...previous,
      lat: clamp(drag.lat + dy * degreesPerPixel, -MAX_TILT, MAX_TILT),
      lon: wrapLon(drag.lon - dx * degreesPerPixel),
      follow: false,
    }))
  }

  function handlePointerUp(event) {
    const canvas = event.currentTarget
    try {
      if (canvas.hasPointerCapture?.(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId)
      }
    } catch {
      // Pointer capture may already be gone.
    }
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null

    if (pointersRef.current.size === 1) {
      const [pointerId, point] = [...pointersRef.current.entries()][0]
      beginPan(pointerId, point.x, point.y)
    } else if (pointersRef.current.size === 0) {
      dragRef.current = null
    }
  }

  function zoomBy(factor) {
    setCamera((previous) => ({
      ...previous,
      zoom: clamp(previous.zoom * factor, MIN_ZOOM, MAX_ZOOM),
    }))
  }

  function resetView() {
    setCamera({ lat: 0, lon: 0, zoom: 1, follow: true })
  }

  function handleKeyDown(event) {
    const key = event.key
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
      event.preventDefault()
      const step = 6 / cameraRef.current.zoom
      setCamera((previous) => {
        const base = previous.follow
          ? defaultCenter(activeMission, launchSite)
          : { lat: previous.lat, lon: previous.lon }
        return {
          ...previous,
          follow: false,
          lat: clamp(
            base.lat + (key === 'ArrowDown' ? step : key === 'ArrowUp' ? -step : 0),
            -MAX_TILT,
            MAX_TILT,
          ),
          lon: wrapLon(
            base.lon + (key === 'ArrowLeft' ? step : key === 'ArrowRight' ? -step : 0),
          ),
        }
      })
      return
    }

    if (key === '+' || key === '=') {
      event.preventDefault()
      zoomBy(1.2)
      return
    }

    if (key === '-' || key === '_') {
      event.preventDefault()
      zoomBy(1 / 1.2)
      return
    }

    if (key.toLowerCase() === 'r') {
      resetView()
    }
  }

  const controlClass =
    'border border-carbon-border bg-carbon-bg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-neutral-400 bezier-fast hover:text-neutral-100'
  const followClass = camera.follow
    ? 'border border-flight-amber bg-flight-amber/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-flight-amber bezier-fast'
    : controlClass

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-grab touch-none focus:outline-none focus-visible:ring-1 focus-visible:ring-flight-amber active:cursor-grabbing"
        aria-label="Globe ortografis interaktif lintasan peluncuran"
        role="application"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={resetView}
        onKeyDown={handleKeyDown}
      />
      <div className="absolute right-2 top-2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setCamera((previous) => ({ ...previous, follow: !previous.follow }))}
          aria-pressed={camera.follow}
          title="Ikuti posisi satelit"
          className={followClass}
        >
          Follow
        </button>
        <button type="button" onClick={() => zoomBy(1.25)} title="Zoom in" className={controlClass}>
          +
        </button>
        <button type="button" onClick={() => zoomBy(0.8)} title="Zoom out" className={controlClass}>
          −
        </button>
        <button type="button" onClick={resetView} title="Reset kamera" className={controlClass}>
          Reset
        </button>
      </div>
    </div>
  )
}
