# 03. Backend Multiplayer Architecture & Database Schema

## 1. Deterministic Event-Driven Simulation (No Per-Second Tick Loops)
Because `1 Real Week = 1 In-Game Year`, the backend must **not** run continuous per-second physics/economy ticks for all agencies. Instead, use a **Deterministic Scheduled Event Queue**:
1. Every player action (research completion, factory rollout completion, static fire test, launch window ignition, orbital burn node, TRL failure check) inserts a record into `scheduled_events` with an exact `execute_at` UTC timestamp.
2. A background worker polls `scheduled_events WHERE status = 'PENDING' AND execute_at <= NOW()`.
3. Outcomes (such as TRL failure rolls) are resolved using a **Seeded PRNG** (`mission_seed + event_id`) so replays and audits are 100% deterministic.
4. Frontend clients calculate smooth progress bars and orbital positions locally via timestamp interpolation (`(NOW() - started_at) / (execute_at - started_at)`).

## 2. Core Relational Database Schema (PostgreSQL / Supabase)

```sql
-- 1. Seasons / Multiplayer Worlds
CREATE TABLE seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  start_real_time TIMESTAMPTZ NOT NULL,
  epoch_game_date DATE NOT NULL DEFAULT '1969-07-20',
  time_scale_multiplier NUMERIC NOT NULL DEFAULT 52.142857, -- 1 real week = 365 game days
  western_tension INT NOT NULL DEFAULT 50,
  eastern_tension INT NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
);

-- 2. Player Space Agencies
CREATE TABLE agencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID REFERENCES seasons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL, -- e.g., 'ISRO', 'ELDO', 'NASDA'
  alignment TEXT NOT NULL CHECK (alignment IN ('WESTERN', 'EASTERN', 'INDEPENDENT')),
  launch_site_lat NUMERIC NOT NULL,
  funding_usd BIGINT NOT NULL DEFAULT 15000000,
  science_points NUMERIC NOT NULL DEFAULT 50.0,
  dependency_meter INT NOT NULL DEFAULT 0 CHECK (dependency_meter BETWEEN 0 AND 100),
  western_standing INT NOT NULL DEFAULT 50,
  eastern_standing INT NOT NULL DEFAULT 50,
  total_engineers INT NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Agency Tech Tree Progress & TRL Tracking
CREATE TABLE agency_tech_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID REFERENCES agencies(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('LOCKED', 'AVAILABLE', 'RESEARCHING', 'UNLOCKED', 'EMBARGOED')),
  is_nationalized_variant BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_engineers INT NOT NULL DEFAULT 0,
  research_started_at TIMESTAMPTZ,
  research_completes_at TIMESTAMPTZ,
  current_trl INT NOT NULL DEFAULT 0,
  trl_xp NUMERIC NOT NULL DEFAULT 0,
  total_activations INT NOT NULL DEFAULT 0,
  failures_recorded INT NOT NULL DEFAULT 0,
  UNIQUE(agency_id, node_id)
);

-- 4. Asynchronous Scheduled Events Queue
CREATE TABLE scheduled_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID REFERENCES seasons(id) ON DELETE CASCADE,
  agency_id UUID REFERENCES agencies(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- 'TECH_COMPLETE', 'STATIC_FIRE', 'ROLLOUT_COMPLETE', 'LAUNCH_IGNITION', 'BURN_NODE'
  reference_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  execute_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSED', 'CANCELLED')),
  result_log JSONB
);
```

## 3. Multiplayer Interaction Systems
- **Commercial Launch Brokerage:** Players with lower `$/kg to LEO` can bid on commercial satellite contracts posted by NPC corporations or other player agencies that lack heavy-lift vehicles.
- **Joint Consortium R&D:** Up to 3 agencies can co-fund a single Era III/IV node (splitting Science & Funding costs by `30%` discount per partner) and share the resulting blueprint.
- **Orbital Reconnaissance & Rollout Visibility:** When a rocket is rolled out to the launch pad (`~24 real hours` before launch), rival agencies with recon satellites passing over that latitude receive intelligence reports estimating payload mass and target inclination.