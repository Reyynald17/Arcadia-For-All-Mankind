-- supabase/schema.sql
-- Schema for AFM (Arcadia: For All Mankind)

-- Agencies (player agencies)
CREATE TABLE IF NOT EXISTS agencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  name text NOT NULL,
  country text,
  culture text,
  history text,
  targets text[],
  ap int DEFAULT 25,
  budget int DEFAULT 50,
  rp int DEFAULT 0,
  si int DEFAULT 70,
  ipi int DEFAULT 60,
  slr int DEFAULT 0,
  total_launches int DEFAULT 0,
  successful_launches int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Technologies
CREATE TABLE IF NOT EXISTS technologies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  era text,
  research_cost_ap int DEFAULT 0,
  research_cost_budget int DEFAULT 0,
  duration_days int DEFAULT 0,
  prerequisite text[],
  created_at timestamptz DEFAULT now()
);

-- Vehicles
CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid REFERENCES agencies(id) ON DELETE SET NULL,
  name text,
  type text,
  reliability int DEFAULT 70,
  status text DEFAULT 'testing',
  total_launches int DEFAULT 0,
  successful_launches int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Missions
CREATE TABLE IF NOT EXISTS missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid REFERENCES agencies(id) ON DELETE SET NULL,
  name text,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  type text,
  result text,
  ap_cost int DEFAULT 0,
  budget_cost int DEFAULT 0,
  crew_deaths int DEFAULT 0,
  launched_at timestamptz,
  completed_at timestamptz
);

-- Logs
CREATE TABLE IF NOT EXISTS logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid REFERENCES agencies(id) ON DELETE SET NULL,
  event_type text,
  description text,
  data jsonb,
  created_at timestamptz DEFAULT now()
);

-- NPCs
CREATE TABLE IF NOT EXISTS npcs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  archetype text,
  ap int DEFAULT 25,
  budget int DEFAULT 50,
  rp int DEFAULT 0,
  si int DEFAULT 70,
  ipi int DEFAULT 60,
  slr int DEFAULT 0,
  strategy jsonb,
  created_at timestamptz DEFAULT now()
);
