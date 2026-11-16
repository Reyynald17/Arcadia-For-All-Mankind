import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = new Set(process.argv.slice(2));
const help = args.has('--help') || args.has('-h');
const apply = args.has('--apply');
const refresh = args.has('--refresh');

if (help) {
  console.log(`Usage: node backend/scripts/migrate-legacy.mjs [--apply] [--refresh]

Default mode is a read-only dry run.

  --apply    Write season, code, alignment, and research progress backfills.
  --refresh  With --apply, overwrite existing agency_tech_nodes rows from logs.
             Without it, only missing rows are inserted.
`);
  process.exit(0);
}

if (apply && args.has('--dry-run')) {
  console.error('Use either --apply or --dry-run, not both.');
  process.exit(1);
}

function loadEnvFile(envPath) {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
    return;
  }

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}

for (const envPath of [path.join(root, 'backend', '.env'), path.join(root, '.env')]) {
  if (fs.existsSync(envPath)) {
    loadEnvFile(envPath);
    break;
  }
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in backend/.env.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PAGE_SIZE = 1000;

async function fetchAll(table, select, applyQuery) {
  const rows = [];
  let from = 0;

  while (true) {
    let query = supabase.from(table).select(select);
    if (applyQuery) query = applyQuery(query);

    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);

    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

const legacyNameToNode = new Map([
  ['propulsi cair tahap i (lox/rp-1)', 'PROP_201_LOX_RP1'],
  ['telemetri dua arah & radar', 'SCNC_101_VHF_TELEMETRY'],
  ['kapsul dua awak valoria-mkii', 'LIFE_201_TWO_CREW_CAPSULE'],
  ['stage separation & ullage rockets', 'STRC_201_STAGE_SEPARATION'],
  ['cryogenic hydrogen stage (lh2/lox)', 'WST_201_CRYO_HYDROLOX'],
  ['heat shield ablatif kecepatan bulan', 'STRC_201_ABLATIVE_HEAT_SHIELD'],
]);

const normalize = (value) => String(value ?? '').trim().toLowerCase();

function getResearchName(log) {
  const fromData = log?.data?.technology || log?.data?.technology_name;
  if (fromData) return String(fromData).trim();

  return String(log?.description ?? '')
    .replace(/^Research (?:started|completed):\s*/i, '')
    .trim();
}

function makeAgencyCode(name) {
  const tokens = String(name ?? '')
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return 'AFM';
  if (tokens.length === 1) return tokens[0].slice(0, 3).padEnd(3, 'X');
  return tokens.map((token) => token[0]).join('').slice(0, 3).padEnd(3, 'X');
}

function uniqueAgencyCode(name, usedCodes) {
  const base = makeAgencyCode(name);
  let candidate = base;
  let suffix = 2;

  while (usedCodes.has(candidate)) {
    candidate = `${base.slice(0, 3)}${suffix}`;
    suffix += 1;
  }

  usedCodes.add(candidate);
  return candidate;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function reportLegacyInventory(reason) {
  console.log('Phase 0 schema is not applied yet. Reading the legacy inventory only.');
  console.log(`Schema check: ${reason}`);

  try {
    const agencies = await fetchAll('agencies', 'id, user_id, name', (query) =>
      query.order('id', { ascending: true }));
    const technologies = await fetchAll('technologies', 'id, name', (query) =>
      query.order('id', { ascending: true }));
    const logs = await fetchAll(
      'logs',
      'id, agency_id, event_type, description, data, created_at',
      (query) =>
        query
          .in('event_type', ['RESEARCH_STARTED', 'RESEARCH_COMPLETED'])
          .order('created_at', { ascending: true })
          .order('id', { ascending: true }),
    );

    let started = 0;
    let completed = 0;
    const pairs = new Set();
    for (const log of logs) {
      if (String(log.event_type).includes('COMPLETED')) completed += 1;
      else started += 1;

      const nodeId = legacyNameToNode.get(normalize(getResearchName(log)));
      if (nodeId && log.agency_id) pairs.add(`${log.agency_id}:${nodeId}`);
    }

    console.log(`- Agencies: ${agencies.length}`);
    console.log(`- Technologies: ${technologies.length}`);
    console.log(`- Research logs: ${logs.length} (started: ${started}; completed: ${completed})`);
    console.log(`- Estimated agency-tech rows: ${pairs.size}`);
  } catch (error) {
    console.log(`Legacy inventory could not be read: ${error.message}`);
  }

  console.log('No writes performed. Apply supabase/migrations/001-004, then re-run for the full report.');
}

async function run() {
  const { data: activeSeasons, error: seasonError } = await supabase
    .from('seasons')
    .select('id, name, start_real_time')
    .eq('status', 'ACTIVE')
    .order('start_real_time', { ascending: false })
    .limit(1);

  if (seasonError || !activeSeasons?.length) {
    const reason = seasonError?.message || 'No ACTIVE season found.';
    if (!apply) {
      await reportLegacyInventory(reason);
      return;
    }
    throw new Error(
      `Cannot start the backfill: ${reason} Apply supabase/migrations/001-004 first.`,
    );
  }

  const activeSeason = activeSeasons[0];

  const [agencies, technologies, existingNodes, researchLogs] = await Promise.all([
    fetchAll(
      'agencies',
      'id, user_id, name, code, season_id, alignment, launch_site_lat, launch_site_lon, total_engineers, profile_complete',
      (query) => query.order('id', { ascending: true }),
    ),
    fetchAll(
      'technologies',
      'node_id, name, alignment_affinity, unlock_trl, duration_days, spec',
      (query) => query.order('node_id', { ascending: true }),
    ),
    fetchAll(
      'agency_tech_nodes',
      'agency_id, node_id, status, current_trl',
      (query) => query.order('agency_id', { ascending: true }).order('node_id', { ascending: true }),
    ),
    fetchAll(
      'logs',
      'id, agency_id, event_type, description, data, created_at',
      (query) =>
        query
          .in('event_type', ['RESEARCH_STARTED', 'RESEARCH_COMPLETED'])
          .order('created_at', { ascending: true })
          .order('id', { ascending: true }),
    ),
  ]);

  const techByNodeId = new Map();
  const techByName = new Map();
  for (const tech of technologies) {
    techByNodeId.set(tech.node_id, tech);
    techByName.set(normalize(tech.name), tech);
    if (tech.spec?.title) techByName.set(normalize(tech.spec.title), tech);
  }

  const unresolvedNames = new Set();
  let resolvedLogs = 0;
  let ignoredLogs = 0;
  const grouped = new Map();

  for (const log of researchLogs) {
    if (!log.agency_id) {
      ignoredLogs += 1;
      continue;
    }

    const rawName = getResearchName(log);
    const normalizedName = normalize(rawName);
    const tech =
      techByName.get(normalizedName) ||
      techByNodeId.get(legacyNameToNode.get(normalizedName));

    if (!tech) {
      ignoredLogs += 1;
      if (rawName) unresolvedNames.add(rawName);
      continue;
    }

    resolvedLogs += 1;
    if (!grouped.has(log.agency_id)) grouped.set(log.agency_id, new Map());
    const agencyEntries = grouped.get(log.agency_id);
    if (!agencyEntries.has(tech.node_id)) {
      agencyEntries.set(tech.node_id, {
        tech,
        startedAt: null,
        completedAt: null,
        durationDays: Number.NaN,
      });
    }

    const entry = agencyEntries.get(tech.node_id);
    const createdAt = Date.parse(log.created_at);
    if (Number.isFinite(createdAt)) {
      if (String(log.event_type).includes('COMPLETED')) {
        if (entry.completedAt === null || createdAt < entry.completedAt) entry.completedAt = createdAt;
      } else if (entry.startedAt === null || createdAt < entry.startedAt) {
        entry.startedAt = createdAt;
      }
    }

    const duration = Number(log?.data?.duration_days);
    if (Number.isFinite(duration) && duration > 0 && !Number.isFinite(entry.durationDays)) {
      entry.durationDays = duration;
    }
  }

  const agencyById = new Map(agencies.map((agency) => [agency.id, agency]));
  const existingKeys = new Set(
    existingNodes.map((node) => `${node.agency_id}:${node.node_id}`),
  );
  const now = Date.now();
  const plannedNodes = [];
  let licensedNodes = 0;

  for (const [agencyId, entries] of grouped) {
    const agency = agencyById.get(agencyId);
    if (!agency) {
      ignoredLogs += entries.size;
      continue;
    }

    for (const entry of entries.values()) {
      const { tech } = entry;
      const isComplete = entry.completedAt !== null;
      const startedAt = entry.startedAt;
      const durationDays = Number.isFinite(entry.durationDays)
        ? entry.durationDays
        : Number(tech.duration_days || 0);
      const computedCompletion =
        startedAt !== null && durationDays > 0
          ? startedAt + durationDays * 86400000
          : null;
      const completedByTime = computedCompletion !== null && computedCompletion <= now;
      const unlocked = isComplete || completedByTime;

      let researchCompletesAt = null;
      if (isComplete) {
        researchCompletesAt = new Date(entry.completedAt).toISOString();
      } else if (computedCompletion !== null) {
        researchCompletesAt = new Date(computedCompletion).toISOString();
      }

      const affinity = tech.alignment_affinity;
      const licensed =
        unlocked &&
        (affinity === 'WESTERN' || affinity === 'EASTERN') &&
        agency.alignment !== affinity;
      if (licensed) licensedNodes += 1;

      plannedNodes.push({
        agency_id: agencyId,
        node_id: tech.node_id,
        status: unlocked ? 'UNLOCKED' : 'RESEARCHING',
        is_nationalized_variant: false,
        assigned_engineers: 0,
        research_started_at: startedAt !== null ? new Date(startedAt).toISOString() : null,
        research_completes_at: researchCompletesAt,
        current_trl: unlocked ? Number(tech.unlock_trl ?? 4) : 0,
        trl_xp: 0,
        total_activations: 0,
        failures_recorded: 0,
        license_status: licensed ? 'LICENSED' : 'NONE',
        local_variant_of: null,
      });
    }
  }

  const usedCodesBySeason = new Map();
  for (const agency of agencies) {
    const seasonId = agency.season_id || activeSeason.id;
    if (!usedCodesBySeason.has(seasonId)) usedCodesBySeason.set(seasonId, new Set());
    if (agency.code) usedCodesBySeason.get(seasonId).add(agency.code);
  }

  const agencyPatches = [];
  for (const agency of agencies) {
    const fields = {};
    const seasonId = agency.season_id || activeSeason.id;
    if (!agency.season_id) fields.season_id = activeSeason.id;
    if (!agency.alignment) fields.alignment = 'INDEPENDENT';
    if (!agency.code) {
      fields.code = uniqueAgencyCode(
        agency.name,
        usedCodesBySeason.get(seasonId),
      );
    }

    if (Object.keys(fields).length > 0) {
      fields.profile_complete = false;
      agencyPatches.push({ id: agency.id, ...fields });
    }
  }

  const newNodes = plannedNodes.filter(
    (row) => !existingKeys.has(`${row.agency_id}:${row.node_id}`),
  );
  const skippedNodes = plannedNodes.length - newNodes.length;
  const nodesToWrite = refresh ? plannedNodes : newNodes;

  console.log('Phase 0 legacy backfill');
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Season: ${activeSeason.name}`);
  console.log(`Agencies scanned: ${agencies.length}; updates queued: ${agencyPatches.length}`);
  console.log(
    `Research logs scanned: ${researchLogs.length}; resolved: ${resolvedLogs}; ignored: ${ignoredLogs}`,
  );
  console.log(
    `Tech rows planned: ${plannedNodes.length}; new: ${newNodes.length}; existing: ${skippedNodes}; licensed: ${licensedNodes}`,
  );
  if (refresh) {
    console.log('Refresh mode: existing agency_tech_nodes rows will be overwritten from logs.');
  }
  if (unresolvedNames.size > 0) {
    const preview = [...unresolvedNames].slice(0, 5).join(' | ');
    console.log(`Unresolved research names: ${unresolvedNames.size} (${preview})`);
  }

  if (!apply) {
    console.log('No writes performed. Review this report before running with --apply.');
    return;
  }

  for (const patch of agencyPatches) {
    const { id, ...fields } = patch;
    const { error } = await supabase.from('agencies').update(fields).eq('id', id);
    if (error) throw new Error(`agencies update ${id}: ${error.message}`);
  }

  for (const batch of chunk(nodesToWrite, 200)) {
    if (batch.length === 0) continue;
    const { error } = refresh
      ? await supabase
        .from('agency_tech_nodes')
        .upsert(batch, { onConflict: 'agency_id,node_id' })
      : await supabase
        .from('agency_tech_nodes')
        .upsert(batch, { onConflict: 'agency_id,node_id', ignoreDuplicates: true });
    if (error) throw new Error(`agency_tech_nodes upsert: ${error.message}`);
  }

  console.log(
    `Applied. Agencies updated: ${agencyPatches.length}; agency_tech_nodes written: ${nodesToWrite.length}.`,
  );
}

run().catch((error) => {
  console.error(`Backfill failed: ${error.message}`);
  console.error('If migrations are not applied yet, apply 001-004 first. Writes are idempotent; re-run is safe.');
  process.exitCode = 1;
});
