# 02. Tech Tree Schema & Mathematical Balancing Models

## 1. Six Core Engineering Disciplines
1. `PROP` — **Propulsion & Rocketry:** Engines, propellant cycles, $I_{sp}$, throttling.
2. `STRC` — **Structures & Materials:** Tanks, staging decouplers, heat shields, clustering frames, artificial gravity rings.
3. `AVNC` — **Avionics & Guidance:** Flight computers, IMUs, LIDAR precision landing, automated docking/propellant transfer.
4. `SCNC` — **Science & Comms:** Telemetry, spectrometers, Deep Space Network (X-Band), optical laser comms, rovers.
5. `LIFE` — **Life Support & Habitats:** Pressurized capsules, EVA suits, open/semi-closed/closed-loop ECLSS, hydroponics.
6. `POWR` — **Power, Thermal & ISRU:** Batteries, solar arrays, RTGs, fission reactors, radiators, lunar/asteroid ISRU mining.

## 2. Era Progression & Independent Track Overview
- **Era I (1945–1958):** Sub-Orbital & Early Orbital Baseline (`PROP-101` Alcohol/LOX, `IND-101` High-Impulse Segmented Solids, Basic Fins, VHF Telemetry).
- **Era II (1959–1969):** Orbital Catch-Up & Lunar Capability (`WST-201` Cryogenic Hydrolox, `EST-201` Hypergolics, `IND-201` Multi-Core Strap-On Clustering, `IND-202` Commercial Payload Reverse-Engineering, Ablative Heat Shields, Pressurized Capsules).
- **Era III (1970–1979):** Stations, Reusability & Decoupling (`EST-301` Closed-Cycle Staged Combustion, `WST-301` Digital Fly-by-Wire & Reusable TPS Tiles, `IND-301` Hybrid Solid-Liquid Upper Stages, `IND-302` Cross-Bloc Interface Adapters & Local Metallurgy, Semi-Closed ECLSS, RTG, X-Band Comms).
- **Era IV (1980–1989):** Deep Space & Industrialization (`PROP-401` Deep-Throttling Propulsive Landing, Ion Thrusters, Closed-Loop ECLSS, Inflatable Habitats, Sabatier ISRU, `IND-401` Equatorial Sea-Launch Platform).
- **Era V–VI (1990+):** Advanced Propulsion & Colonization (Full-Flow Methalox, Nuclear Thermal Propulsion [NERVA], Kilopower Fission, Centrifugal Gravity Rings, Asteroid Metallurgy).

## 3. Mathematical Models & Formulas

### A. Effective Research Duration (Brooks' Law Diminishing Returns)
$$T_{\text{actual}} = \frac{T_{\text{base}}}{\left(\frac{E}{E_{\text{opt}}}\right)^{\alpha} \cdot (1 + 0.15 \cdot N_{\text{prereq\_trl}})}$$
- $T_{\text{base}}$: Base research duration in in-game days.
- $E$: Assigned engineers.
- $E_{\text{opt}}$: Optimal team size for the era (e.g., `20` in Era II).
- $\alpha$: Coordination efficiency exponent (`0.65`).
- $N_{\text{prereq\_trl}}$: Number of direct prerequisite nodes already at `TRL >= 8`.

### B. Technology Readiness Level (TRL 4–9) & Experience Gain
Newly unlocked nodes start at **TRL 4 or 5** (prototype stage). Testing increases `trl_xp`:
$$XP_{\text{gain}} = W_{\text{env}} \cdot \left(1 + \frac{t_{\text{burn}}}{t_{\text{rated}}}\right) \cdot K_{\text{outcome}}$$
- $W_{\text{env}}$: `1.0` (Ground Static Fire), `2.5` (Sub-orbital/Orbital Flight), `4.0` (Deep Space).
- $K_{\text{outcome}}$: `1.0` (Nominal Success), `1.5` (Failure with Telemetry Recovered — learn from failure).
- **XP Required to advance from level $L$ to $L+1$:**
  $$XP_{\text{req}}(L) = 100 \cdot 1.6^{(L - 4)}$$

### C. Component Failure Probability per Ignition/Activation
$$P_{\text{fail}}(\text{TRL}) = P_{\text{min}} + (P_{\text{base}} - P_{\text{min}}) \cdot e^{-0.55 \cdot (\text{TRL} - \text{TRL}_{\text{unlock}})}$$

### D. Factory Re-Tooling Cost (Architecture Switching Penalty)
$$C_{\text{retool}} = C_{\text{base\_line}} \cdot \left(1 - \frac{\text{Commonality}}{100}\right) \cdot (1 + 0.25 \cdot \Delta \text{Era})$$

### E. Geopolitical Dependency Meter ($D \in [0, 100]$)
$$D = \min\left(100, \sum (W_{\text{part}} \cdot N_{\text{imported}}) + \sum W_{\text{tech}} - (0.5 \cdot N_{\text{local\_variants}})\right)$$
- $W_{\text{part}}$: `+8` (Main Engine), `+5` (Avionics), `+3` (Upper Stage/Capsule) per active launch in the last 12 in-game months.
- $W_{\text{tech}}$: `+4` per `LICENSED` foreign tech node.
- **Thresholds:**
  - `0–25%`: Sovereign (Full autonomy).
  - `26–55%`: Technical Partner (`-15%` license cost; military payload restrictions).
  - `56–80%`: Client Dependency (Sponsor can veto rival commercial contracts; `+30–60d` spare parts delay if diplomatic standing `< 60`).
  - `81–100%`: Vassal Integration (Sponsor dictates 40% of mission targets and crew seats).
- **Tech Decoupling (Nationalization):** If embargoed, player can nationalize frozen foreign parts into `_LOCAL` variants, immediately dropping component **TRL by -3** and increasing manufacturing cost by `+35%` for 18 in-game months.

## 4. Reference JSON Node Schema
```json
{
  "id": "PROP_04_STAGED_COMBUSTION",
  "era": 3,
  "discipline_id": "PROP",
  "alignment_affinity": "EASTERN",
  "title": "Closed-Cycle Staged Combustion Engine",
  "prerequisites": {
    "tech_ids": ["EAST_201"],
    "science_requirements": [
      { "experiment_id": "EXP_ORBITAL_RESTART", "min_samples": 2 }
    ]
  },
  "research_cost": {
    "science_points": 210,
    "funding_usd": 4500000,
    "base_days": 220
  },
  "cost_modifiers": {
    "EASTERN": { "science_mult": 0.65, "days_mult": 0.60, "requires_license": true },
    "WESTERN": { "science_mult": 1.35, "days_mult": 1.25, "requires_license": false },
    "INDEPENDENT": { "science_mult": 1.75, "days_mult": 1.60, "requires_license": false }
  },
  "embargo_risk": {
    "is_export_controlled": true,
    "dependency_impact": 18,
    "min_standing_required": 70,
    "fallback_local_variant": "PROP_04_LOCAL_GASGEN_CLUSTER"
  },
  "trl_profile": {
    "unlock_trl": 4,
    "max_trl": 9,
    "base_failure_rate": 0.15,
    "min_failure_rate": 0.008,
    "static_test_cost": 180000
  },
  "unlocks_parts": ["eng_rd253_heavy", "eng_preburner_ox"]
}
```