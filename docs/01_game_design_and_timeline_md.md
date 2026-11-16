# 01. Game Design Document: Post-1969 Alternate History & Real-Time Multiplayer

## 1. Premise & Setting
- **Starting Era:** July/August 1969 (Alternate History inspired by *For All Mankind*).
- **World State:** The Soviet Union has just landed the first human on the Moon (N1/LK success). The US is in political crisis and accelerating lunar/deep-space plans.
- **Player Role:** Players do **not** play as the US or USSR. Players control **Third-Bloc National Space Agencies** (e.g., European, Japanese, Indian, South American, or custom sovereign agencies) entering the space race in 1969.
- **Superpower Factions (AI-Controlled):** NASA (Western Bloc) and OKB-1/Interkosmos (Eastern Bloc) operate as AI geopolitical superpowers that control export licenses, commercial contracts, and geopolitical tension.

## 2. Asynchronous Real-Time Scale
- **Time Conversion Ratio:** `1 Real-Life Week (168 hours) = 1 In-Game Year (365 days)`.
  - `1 Real-Life Day` ≈ `52.14 In-Game Days`.
  - `1 Real-Life Hour` ≈ `2.17 In-Game Days`.
  - `Full Season (1969–1995 / 26 In-Game Years)` = `26 Real-Life Weeks` (~6 months).
- **Real-Time Activity Benchmarks:**
  - **Static Fire Test (15–30 in-game days):** `7 – 14 real-world hours`.
  - **Era II Tech Node Research (90–150 in-game days):** `1.7 – 2.9 real-world days`.
  - **Era III–IV Tech Node Research (240–365 in-game days):** `4.6 – 7 real-world days`.
  - **Rocket Rollout to Pad (45–60 in-game days):** `21 – 28 real-world hours`.
  - **Lunar Transfer (3–4 in-game days):** `1.5 – 2 real-world hours`.
  - **Mars Transfer (180–240 in-game days):** `3.5 – 4.6 real-world days`.
- **Anti-Burnout / Asynchronous Rules:**
  - Players do not need to be online 24/7.
  - All orbital transfers, staging events, and landings use **Pre-Programmed Flight Plans (Queued Burn Nodes)** and **Automated Contingency Rules** (e.g., auto-abort if chamber pressure drops below 70% at T+45s) configured prior to launch.

## 3. Hemisphere Alignment (Starting Doctrine)
At campaign start (1969), each player selects one of three architectural doctrines:
1. **Western Alignment (NASA/ELDO Accord):**
   - **Starting Tech:** Early Era II unlocked (RP-1/LOX basics, inertial avionics).
   - **Bonuses:** `-35%` R&D science/time cost on Western-aligned nodes; ability to purchase off-the-shelf (COTS) US engines/stages.
   - **Specialty:** High-$I_{sp}$ Cryogenic Hydrolox upper stages, miniaturized digital avionics, reusable ceramic TPS tiles.
   - **Risk:** High dependency; subject to US export embargoes and mission vetoes.
2. **Eastern Alignment (Interkosmos Protocol):**
   - **Starting Tech:** Early Era II unlocked (Hypergolic propulsion, automated orbital capsules).
   - **Bonuses:** `-35%` R&D science/time cost on Eastern-aligned nodes; `-25%` mass-production hardware cost.
   - **Specialty:** Closed-cycle Staged Combustion engines, long-duration storable hypergolics, automated rendezvous/docking.
   - **Risk:** High dependency; mandatory crew/payload quotas for Soviet bloc missions; blueprint revocation risk.
3. **Independent / Non-Aligned (Sovereign Charter):**
   - **Starting Tech:** Late Era I unlocked (Solid rocket boosters & basic liquid engines; early orbital capability only).
   - **Penalties:** `+75%` R&D science/time cost when reverse-engineering foreign technologies; `-20%` base research speed.
   - **Specialty:** Zero embargo risk; exclusive access to **Segmented Solid Boosters**, **Multi-Core Rocket Clustering**, and **Cross-Bloc Interface Adapters** (mixing Western/Eastern/Domestic parts without compatibility penalties).

## 4. Core Multiplayer Gameplay Loop & Operational Pillars
1. **R&D & Geopolitics:** Allocate engineers to tech nodes, manage `Dependency Meter`, and negotiate licenses or joint consortium research with other players.
2. **Manufacturing & VAB Integration:** Produce rocket families on limited assembly bays. Changing rocket architectures incurs factory **Re-Tooling Costs** and **Rollout Delays** (~21–28 real-world hours on the launch pad).
3. **Launch Geography & Ground Tracking:** Execute launches constrained by launch site latitude/azimuth and **Ground Tracking Station** coverage (blind spots require tracking ships, allied ground stations, or relay satellites).
4. **Personnel & Institutional Memory:** Recruit specialized astronauts (*Pilots*, *Flight Engineers*, *Mission Specialists*). Crew fatalities trigger parliamentary investigations, grounding manned flights for 6–12 in-game months and slashing annual budgets.
5. **Commercial Launch Market & Evaluation:** Gain Science Points, increase component **TRL (Technology Readiness Level)** through flight telemetry, and fulfill commercial satellite launch contracts (`$/kg to LEO/GTO`) to fund independent exploration.