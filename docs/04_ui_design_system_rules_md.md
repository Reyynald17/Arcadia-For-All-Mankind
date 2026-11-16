# 04. UI/UX Design System Rules (Mission Control Technical Aesthetic)

When generating or refactoring any frontend interface for this game, strictly enforce the following visual and structural rules. **Do NOT generate generic AI / "vibe-coded" UI patterns.**

## 1. Visual Identity & Color Restraint (60-30-10 Rule)
- **Aesthetic Direction:** Cold War / 1970s–1980s Aerospace Mission Control & Technical Engineering Schematic.
- **Surface Palette:**
  - Primary Canvas: `#09090B` (`zinc-950`) with subtle `1px` technical grid (`#18181B`).
  - Elevated Panels / Inspector Dossiers: `#18181B` (`zinc-900`) separated by crisp `1px solid #27272A` (`zinc-800`) borders.
- **Single Functional Accent:**
  - Use **Signal Amber** (`#D97706` / `amber-600`) exclusively for active research progress, warnings, and primary action triggers.
  - Use **Telemetry Emerald** (`#10B981` / `emerald-500`) exclusively for verified `TRL 8–9 / Man-Rated` hardware states.
- **STRICTLY BANNED:**
  - High-saturation neon palettes, ambient radial light blooms (`blur-3xl`), aurora background gradients, drop-shadow glows, and purple-to-indigo gradients (`from-purple-500 to-indigo-600`).

## 2. Typography & Tabular Precision
- **UI & Body Font:** `Inter` or `IBM Plex Sans` (`12px–14px` dense technical layout).
- **Data, Metrics & Codes Font:** `IBM Plex Mono` or `JetBrains Mono` with `font-variant-numeric: tabular-nums` enforced on all costs, science points, TRL counters, failure probabilities, and countdown timers.

## 3. Layout & Component Discipline
- **Flat Information Hierarchy:** Group data using `1px` structural dividers, grid alignment, and typographic scale. Never nest cards inside cards more than one level deep.
- **Zero Emojis in UI:** Never use emojis (`🚀`, `🛰️`, `⚡`, `🔬`) as icons, navigation items, or bullet points. Use clean `16px` monochrome SVG technical icons with uniform `1.5px` stroke width.
- **Purposeful Indicators:**
  - **BANNED:** Decorative rainbow left-border tabs cycling across cards.
  - **BANNED:** Colored status dots attached to static headers. Status badges must display explicit engineering states (`LOCKED`, `READY`, `ACTIVE 65%`, `TRL 8/9`, `EMBARGOED`).
- **SVG Dependency Connectors:** Render prerequisite lines between tech nodes using clean orthogonal or cubic-bezier `1px` SVG paths (`#3F3F46` default, `#D97706` highlighted on hover).