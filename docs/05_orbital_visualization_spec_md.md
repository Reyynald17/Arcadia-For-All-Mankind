# 05. 3D Launch Globe & 2D Orbital Ground Track Visualization Spec

This document defines the architecture, mathematical projections, and visual constraints for the **3D Launch Trajectory Globe** and the **2D Satellite Ground Track Map** (Mission Control Range Safety & Telemetry view).

## 1. Visual & Aesthetic Rules (Strict Adherence to `04_UI_DESIGN_SYSTEM_RULES.md`)
- **No Sci-Fi Neon Holograms:** Do NOT render glowing blue hologram Earths, bloom post-processing shaders, or floating neon rings.
- **Technical Cartography Style:**
  - **Ocean / Void:** `#09090B` (`zinc-950`).
  - **Landmasses:** `#18181B` (`zinc-900`) filled polygons with crisp `1px` `#3F3F46` (`zinc-700`) coastline vector outlines (GeoJSON / TopoJSON).
  - **Graticule (Lat/Lon Grid):** `15°` or `30°` intervals rendered as thin `1px` `#27272A` (`zinc-800`) lines.
  - **Trajectory & Ground Track Vectors:**
    - Active Ascent / Current Orbit: Solid `1.5px` Signal Amber (`#D97706`).
    - Predicted Future Orbits (+2 Revolutions): Dashed `1px` (`stroke-dasharray: 4 4`) Zinc-400 (`#A1A1AA`).
    - Historical / Completed Ground Track: Solid `1px` Zinc-600 (`#52525B`).
  - **Ground Station Coverage Cones:** Thin `1px` dashed circles (`#10B981` when satellite is within line-of-sight acquisition range, `#52525B` when idle).

## 2. 3D Launch Globe Specification (Three.js / WebGL or Canvas Orthographic)
Used during **Rollout, Launch Countdown, and Powered Ascent Phases**.

### A. Coordinate Conversion (Geodetic to 3D Cartesian)
Convert Launch Site `(lat, lon)` and rocket altitude `h` (in km) to 3D sphere coordinates (Earth Radius $R_E = 6371\text{ km}$, normalized to unit radius $R = 1.0$):
$$\phi = \text{lat} \cdot \frac{\pi}{180}, \quad \lambda = \text{lon} \cdot \frac{\pi}{180}, \quad r = 1 + \frac{h}{6371}$$
$$x = r \cdot \cos(\phi) \cdot \cos(\lambda), \quad y = r \cdot \sin(\phi), \quad z = -r \cdot \cos(\phi) \cdot \sin(\lambda)$$

### B. Launch Azimuth & Downrange Impact Zones
- **Launch Azimuth ($\beta$):** Calculated from launch site latitude $\phi_0$ and target orbital inclination $i$:
  $$\sin(\beta) = \frac{\cos(i)}{\cos(\phi_0)}$$
  *(Note: If $|\cos(i)| > |\cos(\phi_0)|$, the inclination is unreachable directly without an expensive plane-change dogleg maneuver).*
- **Stage Drop Zones (Range Safety):** Render elliptical hazard zones along the ascent azimuth on the 3D globe showing where Booster / First Stage separation impacts will occur (penalizing diplomatic standing if overlapping rival territory).

### C. Camera & Real-Time Interpolation
- During powered ascent, interpolate rocket position along a **Gravity Turn Bezier/Pitch Curve** from vertical (`90°` pitch at $T+0$) to horizontal orbital velocity (`7.8 km/s` at target perigee).
- Display synchronized HUD telemetry overlays in `IBM Plex Mono`: `ALT (KM)`, `VEL (M/S)`, `DOWNRANGE (KM)`, `INCLINATION (DEG)`, and `MAX-Q / DYNAMIC PRESSURE`.

## 3. 2D Orbital Ground Track Map Specification (Equirectangular / Sinusoidal Projection)
Used in the **Mission Control Tracking Room** for active satellites, lunar transfer injection windows, and reconnaissance overflight detection.

### A. Ground Track Calculation (Including Earth Rotation)
As a satellite moves along an inclined circular/elliptical orbit with angular velocity $\omega_s = \sqrt{\mu / a^3}$ and true anomaly $\nu(t)$, Earth rotates eastward at $\omega_E \approx 7.2921 \times 10^{-5}\text{ rad/s}$ (scaled by `time_scale_multiplier` in real-time multiplayer):
1. **Sub-Satellite Latitude ($\phi_s$):**
   $$\phi_s(t) = \arcsin\big(\sin(i) \cdot \sin(\omega + \nu(t))\big)$$
2. **Sub-Satellite Longitude ($\lambda_s$):**
   $$\lambda_s(t) = \lambda_{\Omega} + \arctan2\big(\cos(i) \cdot \sin(\omega + \nu(t)), \cos(\omega + \nu(t))\big) - \omega_E \cdot (t - t_0)$$
   Normalize $\lambda_s(t)$ to $[-180^\circ, +180^\circ]$.
3. **Antimeridian Wrap Handling:** When $\lambda_s$ crosses $\pm 180^\circ$, break the SVG `<polyline>` / Canvas path segment to prevent horizontal wrap-around lines across the map.

### B. Telemetry Blind Spots & Line-of-Sight (LOS)
- **Communication Blackout Mechanic:** Commands (such as mid-course burns or payload deployment) can only be uploaded in real-time when the sub-satellite point lies inside the **Horizon Visibility Circle** of an owned/allied **Ground Tracking Station**, a **Tracking Ship**, or a **TDRS Relay Satellite**.
- **Visibility Radius ($\theta_{\text{LOS}}$):**
  $$\theta_{\text{LOS}} = \arccos\left(\frac{R_E}{R_E + h}\right) - \epsilon_{\text{min}}$$
  where $\epsilon_{\text{min}}$ is the minimum elevation angle (`5°`).
- **Reconnaissance Overflight Detection:** If a rival player's reconnaissance satellite passes within its sensor swath width of your launch site while a rocket is on the pad (`ROLLOUT` status), trigger an intelligence leak event.