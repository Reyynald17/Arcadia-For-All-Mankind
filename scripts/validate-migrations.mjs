import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');

const expectedFiles = [
  '001_core_schema.sql',
  '002_rls.sql',
  '003_seed_tech.sql',
  '004_seed_stations.sql',
];
const requiredTables = [
  'seasons',
  'agencies',
  'technologies',
  'agency_tech_nodes',
  'scheduled_events',
  'ground_stations',
  'parts',
  'agency_parts',
  'vehicles',
  'missions',
  'logs',
  'npcs',
];
const newTables = [
  'seasons',
  'agency_tech_nodes',
  'scheduled_events',
  'ground_stations',
  'parts',
  'agency_parts',
];
const baseTables = ['agencies', 'technologies', 'vehicles', 'missions', 'logs', 'npcs'];
const alteredTables = ['agencies', 'technologies', 'missions', 'vehicles'];
const legacyTechNames = [
  'PROPULSI CAIR TAHAP I (LOX/RP-1)',
  'TELEMETRI DUA ARAH & RADAR',
  'KAPSUL DUA AWAK VALORIA-MKII',
  'STAGE SEPARATION & ULLAGE ROCKETS',
  'CRYOGENIC HYDROGEN STAGE (LH2/LOX)',
  'HEAT SHIELD ABLATIF KECEPATAN BULAN',
];

const errors = [];
const notes = [];

function readMigration(file) {
  const filePath = path.join(migrationsDir, file);
  if (!fs.existsSync(filePath)) {
    errors.push(`Missing migration: ${file}`);
    return '';
  }
  return fs.readFileSync(filePath, 'utf8');
}

const sql = Object.fromEntries(expectedFiles.map((file) => [file, readMigration(file)]));
const combined = Object.values(sql).join('\n');

if (/\b(drop\s+table|truncate|delete\s+from|drop\s+schema)\b/i.test(combined)) {
  errors.push('Migrations contain a destructive statement (DROP TABLE/TRUNCATE/DELETE/DROP SCHEMA).');
}

for (const table of [...baseTables, ...newTables]) {
  if (!new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+${table}\\b`, 'i').test(sql['001_core_schema.sql'])) {
    errors.push(`001 is missing CREATE TABLE IF NOT EXISTS ${table}.`);
  }
}

for (const table of alteredTables) {
  if (!new RegExp(`alter\\s+table\\s+${table}\\b`, 'i').test(sql['001_core_schema.sql'])) {
    errors.push(`001 is missing ALTER TABLE ${table}.`);
  }
}

for (const table of requiredTables) {
  if (!new RegExp(`alter\\s+table\\s+${table}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(sql['002_rls.sql'])) {
    errors.push(`002 is missing RLS enablement for ${table}.`);
  }
}

for (const column of [
  'season_id',
  'code',
  'alignment',
  'launch_site_lat',
  'launch_site_lon',
  'funding_usd',
  'science_points',
  'dependency_meter',
  'total_engineers',
  'profile_complete',
]) {
  if (!new RegExp(`add\\s+column\\s+if\\s+not\\s+exists\\s+${column}\\b`, 'i').test(sql['001_core_schema.sql'])) {
    errors.push(`001 is missing agencies.${column}.`);
  }
}

for (const column of [
  'node_id',
  'discipline_id',
  'alignment_affinity',
  'era_number',
  'research_cost_science',
  'research_cost_funding',
  'base_days',
  'prerequisite_node_ids',
  'unlock_trl',
  'spec',
]) {
  if (!new RegExp(`add\\s+column\\s+if\\s+not\\s+exists\\s+${column}\\b`, 'i').test(sql['001_core_schema.sql'])) {
    errors.push(`001 is missing technologies.${column}.`);
  }
}

for (const name of legacyTechNames) {
  if (!sql['001_core_schema.sql'].includes(`'${name}'`)) {
    errors.push(`001 is missing the legacy mapping for: ${name}`);
  }
  if (!sql['003_seed_tech.sql'].includes(`'${name}'`)) {
    errors.push(`003 is missing the legacy display name for: ${name}`);
  }
}

const techRows = sql['003_seed_tech.sql']
  .split('\n')
  .filter((line) => /^\s*\('[A-Z][A-Z0-9_]+',/.test(line));

const nodeIds = new Map();
for (const line of techRows) {
  const idMatch = line.match(/^\s*\('([A-Z][A-Z0-9_]+)'/);
  if (!idMatch) continue;
  const nodeId = idMatch[1];
  if (nodeIds.has(nodeId)) {
    errors.push(`Duplicate tech node_id in 003: ${nodeId}`);
  }

  const prereqMatch = line.match(/ARRAY\[(.*?)\]::text\[\]/);
  if (!prereqMatch) {
    errors.push(`Tech row is missing an ARRAY prerequisite literal: ${nodeId}`);
    continue;
  }
  const prereqs = [...prereqMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  if (prereqs.includes(nodeId)) {
    errors.push(`Tech node depends on itself: ${nodeId}`);
  }
  nodeIds.set(nodeId, prereqs);
}

if (nodeIds.size < 20) {
  errors.push(`Expected at least 20 tech nodes in 003, found ${nodeIds.size}.`);
}
notes.push(`Tech nodes: ${nodeIds.size}`);

for (const [nodeId, prereqs] of nodeIds) {
  for (const prereq of prereqs) {
    if (!nodeIds.has(prereq)) {
      errors.push(`Tech node ${nodeId} references missing prerequisite ${prereq}.`);
    }
  }
}

const visiting = new Set();
const visited = new Set();
const reportedCycles = new Set();

function visit(nodeId, stack) {
  if (visiting.has(nodeId)) {
    const cycle = [...stack, nodeId].join(' -> ');
    if (!reportedCycles.has(cycle)) {
      errors.push(`Tech tree cycle detected: ${cycle}`);
      reportedCycles.add(cycle);
    }
    return;
  }
  if (visited.has(nodeId)) return;

  visiting.add(nodeId);
  for (const prereq of nodeIds.get(nodeId) ?? []) {
    visit(prereq, [...stack, nodeId]);
  }
  visiting.delete(nodeId);
  visited.add(nodeId);
}

for (const nodeId of nodeIds.keys()) visit(nodeId, []);

if (!/insert\s+into\s+technologies/i.test(sql['003_seed_tech.sql'])
  || !/on\s+conflict\s*\(\s*node_id\s*\)/i.test(sql['003_seed_tech.sql'])) {
  errors.push('003 must upsert technologies with ON CONFLICT (node_id).');
}

const stationRows = sql['004_seed_stations.sql']
  .split('\n')
  .filter((line) => /^\s*\('GDS_[A-Z0-9_]+',/.test(line));
const stationCodes = new Set();
for (const line of stationRows) {
  const match = line.match(
    /^\s*\('([A-Z0-9_]+)',\s*'([^']+)',\s*'([^']+)',\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*'(GROUND|SHIP|RELAY)',\s*'(WESTERN|EASTERN|INDEPENDENT|NEUTRAL)'/,
  );
  if (!match) {
    errors.push(`Could not parse station row: ${line.trim().slice(0, 60)}...`);
    continue;
  }
  const [, code, , , latRaw, lonRaw, minElevRaw] = match;
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  const minElev = Number(minElevRaw);
  if (stationCodes.has(code)) errors.push(`Duplicate station code: ${code}`);
  stationCodes.add(code);
  if (!(lat >= -90 && lat <= 90)) errors.push(`Station ${code} has invalid latitude.`);
  if (!(lon >= -180 && lon <= 180)) errors.push(`Station ${code} has invalid longitude.`);
  if (!(minElev >= 0 && minElev <= 90)) errors.push(`Station ${code} has invalid minimum elevation.`);
}

if (stationRows.length === 0) errors.push('004 contains no station rows.');
notes.push(`Ground stations: ${stationCodes.size}`);

const snapshotPath = path.join(root, 'supabase', 'schema.sql');
if (!fs.existsSync(snapshotPath)) {
  errors.push('supabase/schema.sql is missing. Run npm run db:schema.');
} else {
  const snapshot = fs.readFileSync(snapshotPath, 'utf8');
  for (const file of expectedFiles) {
    if (!snapshot.includes(`-- ===== ${file} =====`)) {
      errors.push(`supabase/schema.sql is stale: missing ${file}. Run npm run db:schema.`);
    }
  }
}

if (errors.length > 0) {
  console.error('Migration validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Migration validation passed.');
for (const note of notes) console.log(`- ${note}`);
