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
  '005_diplomacy.sql',
  '006_diplomacy_rls.sql',
  '007_seed_npc_diplomacy.sql',
  '008_economy.sql',
  '009_economy_rls.sql',
  '010_contract_mission_link.sql',
  '011_audit_events.sql',
  '012_audit_append_only.sql',
  '013_mission_feasibility.sql',
  '014_annual_budget.sql',
  '015_personnel_investigations.sql',
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

const destructive = /\b(drop\s+table|delete\s+from|drop\s+schema)\b/i.test(combined)
  || /\btruncate\s+(?!on\b)(table\s+)?[a-z_"]/i.test(combined);
if (destructive) {
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

const diplomacyTables = [
  'agency_relations',
  'diplomatic_proposals',
  'agency_agreements',
  'diplomatic_events',
  'agency_bloc_saturation',
];

for (const table of diplomacyTables) {
  if (!new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+${table}\\b`, 'i').test(sql['005_diplomacy.sql'])) {
    errors.push(`005 is missing CREATE TABLE IF NOT EXISTS ${table}.`);
  }
  if (!new RegExp(`alter\\s+table\\s+${table}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(sql['006_diplomacy_rls.sql'])) {
    errors.push(`006 is missing RLS enablement for ${table}.`);
  }
  if (!new RegExp(`create\\s+policy\\s+${table}_read_own`, 'i').test(sql['006_diplomacy_rls.sql'])) {
    errors.push(`006 is missing the read-own policy for ${table}.`);
  }
}

for (const column of ['bloc', 'controller_type', 'npc_profile', 'is_active']) {
  if (!new RegExp(`add\\s+column\\s+if\\s+not\\s+exists\\s+${column}\\b`, 'i').test(sql['005_diplomacy.sql'])) {
    errors.push(`005 is missing agencies.${column}.`);
  }
}

for (const rpc of [
  'diplomacy_bloc_size',
  'diplomacy_counterpart_count',
  'diplomacy_saturation_snapshot',
  'diplomacy_refresh_saturation',
  'accept_diplomatic_proposal',
]) {
  if (!new RegExp(`create\\s+or\\s+replace\\s+function\\s+${rpc}\\s*\\(`, 'i').test(sql['005_diplomacy.sql'])) {
    errors.push(`005 is missing function ${rpc}.`);
  }
}

if (!/create\s+unique\s+index\s+if\s+not\s+exists\s+diplomatic_proposals_pending_pair_idx/i.test(sql['005_diplomacy.sql'])) {
  errors.push('005 is missing the pending-pair unique index for diplomatic_proposals.');
}
if (!/create\s+index\s+if\s+not\s+exists\s+agency_agreements_live_idx/i.test(sql['005_diplomacy.sql'])) {
  errors.push('005 is missing the live agreement index for agency_agreements.');
}

const npcRows = sql['007_seed_npc_diplomacy.sql']
  .split('\n')
  .filter((line) => /^\s*\('NPC_[A-Z0-9_]+',/.test(line));
const npcBlocs = { western: 0, eastern: 0, neutral: 0 };
const npcCodes = new Set();
for (const line of npcRows) {
  const match = line.match(/^\s*\('([A-Z0-9_]+)',\s*'[^']*',\s*'[^']*',\s*'(western|eastern|neutral)',\s*'[^']*',\s*'(cooperative|opportunistic|isolationist)'/);
  if (!match) {
    errors.push(`Could not parse NPC seed row: ${line.trim().slice(0, 60)}...`);
    continue;
  }
  const [, code, bloc] = match;
  if (npcCodes.has(code)) errors.push(`Duplicate NPC agency code in 007: ${code}`);
  npcCodes.add(code);
  npcBlocs[bloc] += 1;
}

for (const [bloc, count] of Object.entries(npcBlocs)) {
  if (count < 4) errors.push(`007 seeds only ${count} NPC agencies for bloc ${bloc} (expected at least 4).`);
}
if (npcRows.length < 12) errors.push(`007 seeds only ${npcRows.length} NPC agencies (expected at least 12).`);
notes.push(`NPC agencies: ${npcCodes.size} (western ${npcBlocs.western}, eastern ${npcBlocs.eastern}, neutral ${npcBlocs.neutral})`);

const economyTables = [
  'agency_contracts',
  'agency_grants',
  'mission_rewards',
  'mission_queue',
];

for (const table of economyTables) {
  if (!new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+${table}\\b`, 'i').test(sql['008_economy.sql'])) {
    errors.push(`008 is missing CREATE TABLE IF NOT EXISTS ${table}.`);
  }
  if (!new RegExp(`alter\\s+table\\s+${table}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(sql['009_economy_rls.sql'])) {
    errors.push(`009 is missing RLS enablement for ${table}.`);
  }
  if (!new RegExp(`create\\s+policy\\s+${table}_read_own`, 'i').test(sql['009_economy_rls.sql'])) {
    errors.push(`009 is missing the read-own policy for ${table}.`);
  }
}

for (const column of ['contract_id', 'queue_id']) {
  if (!new RegExp(`add\\s+column\\s+if\\s+not\\s+exists\\s+${column}\\b`, 'i').test(sql['008_economy.sql'])) {
    errors.push(`008 is missing missions.${column}.`);
  }
}

for (const fn of ['settle_mission_rewards', 'claim_agency_grant']) {
  if (!new RegExp(`create\\s+or\\s+replace\\s+function\\s+${fn}\\s*\\(`, 'i').test(sql['008_economy.sql'])) {
    errors.push(`008 is missing function ${fn}.`);
  }
}

if (!/create\s+or\s+replace\s+function\s+settle_mission_rewards\s*\(/i.test(sql['010_contract_mission_link.sql'])) {
  errors.push('010 is missing the settle_mission_rewards replacement.');
}
if (!/mission_id\s*=\s*p_mission_id/i.test(sql['010_contract_mission_link.sql'])) {
  errors.push('010 does not link agency_contracts.mission_id during settlement.');
}
if (!/update\s+agency_contracts/i.test(sql['010_contract_mission_link.sql'])) {
  errors.push('010 is missing the agency_contracts backfill.');
}

if (!/create\s+table\s+if\s+not\s+exists\s+audit_events\b/i.test(sql['011_audit_events.sql'])) {
  errors.push('011 is missing CREATE TABLE IF NOT EXISTS audit_events.');
}
for (const column of [
  'actor_type',
  'actor_id',
  'action',
  'entity_type',
  'entity_id',
  'before_data',
  'after_data',
  'delta_data',
  'metadata',
  'agency_id',
  'season_id',
  'created_at',
]) {
  if (!new RegExp(`\\b${column}\\b`, 'i').test(sql['011_audit_events.sql'])) {
    errors.push(`011 is missing audit_events.${column}.`);
  }
}
if (!/alter\s+table\s+audit_events\s+enable\s+row\s+level\s+security/i.test(sql['011_audit_events.sql'])) {
  errors.push('011 is missing RLS enablement for audit_events.');
}

for (const event of ['update', 'delete', 'truncate']) {
  if (!new RegExp(`before\\s+${event}\\s+on\\s+audit_events\\b`, 'i').test(sql['012_audit_append_only.sql'])) {
    errors.push(`012 is missing the append-only trigger for ${event.toUpperCase()}.`);
  }
}
if (!/create\s+or\s+replace\s+function\s+audit_events_reject_mutation\s*\(/i.test(sql['012_audit_append_only.sql'])) {
  errors.push('012 is missing the audit_events_reject_mutation function.');
}
if (!/drop\s+constraint\s+if\s+exists\s+audit_events_agency_id_fkey/i.test(sql['012_audit_append_only.sql'])) {
  errors.push('012 is missing the agency FK removal.');
}

for (const column of [
  'vehicle_class',
  'dry_mass_kg',
  'propellant_mass_kg',
  'payload_capacity_kg',
  'delta_v_budget_m_s',
  'crew_capacity',
]) {
  if (!new RegExp(`add\\s+column\\s+if\\s+not\\s+exists\\s+${column}\\b`, 'i').test(sql['013_mission_feasibility.sql'])) {
    errors.push(`013 is missing vehicles.${column}.`);
  }
}
if (!/create\s+or\s+replace\s+function\s+vehicles_apply_performance_defaults\s*\(/i.test(sql['013_mission_feasibility.sql'])) {
  errors.push('013 is missing the vehicle performance default function.');
}
if (!/before\s+insert\s+or\s+update\s+on\s+vehicles\b/i.test(sql['013_mission_feasibility.sql'])) {
  errors.push('013 is missing the vehicle performance default trigger.');
}
if (!/vehicles_performance_nonnegative_check/i.test(sql['013_mission_feasibility.sql'])) {
  errors.push('013 is missing the vehicle performance non-negative constraint.');
}

if (!/create\s+table\s+if\s+not\s+exists\s+agency_budget_cycles\b/i.test(sql['014_annual_budget.sql'])) {
  errors.push('014 is missing CREATE TABLE IF NOT EXISTS agency_budget_cycles.');
}
for (const column of [
  'agency_id',
  'season_id',
  'cycle_year',
  'appropriation_usd',
  'operating_cost_usd',
  'upkeep_usd',
  'net_usd',
  'funding_before_usd',
  'funding_after_usd',
  'unpaid_usd',
  'status',
  'details',
]) {
  if (!new RegExp(`\\b${column}\\b`, 'i').test(sql['014_annual_budget.sql'])) {
    errors.push(`014 is missing agency_budget_cycles.${column}.`);
  }
}
if (!/unique\s*\(\s*agency_id,\s*season_id,\s*cycle_year\s*\)/i.test(sql['014_annual_budget.sql'])) {
  errors.push('014 is missing the annual budget cycle uniqueness guard.');
}
if (!/alter\s+table\s+agency_budget_cycles\s+enable\s+row\s+level\s+security/i.test(sql['014_annual_budget.sql'])) {
  errors.push('014 is missing RLS enablement for agency_budget_cycles.');
}
if (!/create\s+policy\s+agency_budget_cycles_read_own/i.test(sql['014_annual_budget.sql'])) {
  errors.push('014 is missing the read-own policy for agency_budget_cycles.');
}
if (!/create\s+or\s+replace\s+function\s+settle_annual_budget\s*\(/i.test(sql['014_annual_budget.sql'])) {
  errors.push('014 is missing the settle_annual_budget function.');
}
if (!/grant\s+execute\s+on\s+function\s+settle_annual_budget/i.test(sql['014_annual_budget.sql'])) {
  errors.push('014 is missing the settle_annual_budget service_role grant.');
}

const personnelTables = [
  'agency_crew',
  'mission_crew',
  'mission_investigations',
];

for (const table of personnelTables) {
  if (!new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+${table}\\b`, 'i').test(sql['015_personnel_investigations.sql'])) {
    errors.push(`015 is missing CREATE TABLE IF NOT EXISTS ${table}.`);
  }
  if (!new RegExp(`alter\\s+table\\s+${table}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(sql['015_personnel_investigations.sql'])) {
    errors.push(`015 is missing RLS enablement for ${table}.`);
  }
  if (!new RegExp(`create\\s+policy\\s+${table}_read_own`, 'i').test(sql['015_personnel_investigations.sql'])) {
    errors.push(`015 is missing the read-own policy for ${table}.`);
  }
}

for (const column of [
  'role',
  'experience',
  'missions_flown',
  'salary_usd',
  'training_cost_usd',
  'ready_at',
]) {
  if (!new RegExp(`\\b${column}\\b`, 'i').test(sql['015_personnel_investigations.sql'])) {
    errors.push(`015 is missing agency_crew.${column}.`);
  }
}
for (const column of [
  'crew_id',
  'outcome',
]) {
  if (!new RegExp(`\\b${column}\\b`, 'i').test(sql['015_personnel_investigations.sql'])) {
    errors.push(`015 is missing mission_crew.${column}.`);
  }
}
for (const column of [
  'stage',
  'cause',
  'findings',
  'reliability_bonus',
  'completes_at',
]) {
  if (!new RegExp(`\\b${column}\\b`, 'i').test(sql['015_personnel_investigations.sql'])) {
    errors.push(`015 is missing mission_investigations.${column}.`);
  }
}
if (!/unique\s*\(\s*mission_id\s*\)/i.test(sql['015_personnel_investigations.sql'])) {
  errors.push('015 is missing the one-investigation-per-mission guard.');
}

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
