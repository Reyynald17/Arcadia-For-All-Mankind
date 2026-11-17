const express = require('express');
const { randomUUID } = require('node:crypto');
const AGMEngine = require('../services/agm');
const { loadActiveSeason, gameDaysToRealMs, MS_PER_DAY } = require('../services/gameClock');
const {
  assignedEngineersForAgency,
  calculateResearchDurationDays,
} = require('../services/researchEngine');
const { planStaticFire } = require('../services/trlEngine');
const { hashSeed } = require('../services/seededRng');

const ACTIVE_RESEARCH_STATUSES = new Set(['RESEARCHING', 'UNLOCKED', 'EMBARGOED']);

function loggedTechnologyName(log) {
  const fromData = log?.data?.technology || log?.data?.technology_name;
  if (fromData) return String(fromData).trim();

  return String(log?.description || '')
    .replace(/^Research (?:started|completed):\s*/i, '')
    .trim();
}

function alignmentModifier(tech, agency) {
  const modifiers = tech?.spec?.cost_modifiers || {};
  const modifier = modifiers[agency?.alignment] || {};
  return {
    science_mult: Number(modifier.science_mult) > 0 ? Number(modifier.science_mult) : 1,
    days_mult: Number(modifier.days_mult) > 0 ? Number(modifier.days_mult) : 1,
    requires_license: Boolean(modifier.requires_license),
  };
}

function embargoStanding(tech, agency) {
  const affinity = tech?.alignment_affinity;
  if (!tech?.is_export_controlled || affinity === 'ANY' || affinity === agency?.alignment) {
    return { blocked: false, standing: null, required: null };
  }

  const required = Number(
    tech?.spec?.embargo_risk?.min_standing_required
    ?? (tech.is_export_controlled ? 70 : 0),
  );
  const standing = affinity === 'WESTERN'
    ? Number(agency?.western_standing || 0)
    : Number(agency?.eastern_standing || 0);

  return { blocked: standing < required, standing, required };
}

function resolveResearchCost(tech, agency) {
  const modifier = alignmentModifier(tech, agency);
  const sciencePoints = Math.max(
    1,
    Math.round(Number(tech.research_cost_science || 0) * modifier.science_mult),
  );
  const fundingUsd = Math.max(0, Number(tech.research_cost_funding || 0));
  const baseDays = Math.max(0, Number(tech.base_days || 0)) * modifier.days_mult;

  return {
    science_points: sciencePoints,
    funding_usd: fundingUsd,
    base_days: Number(baseDays.toFixed(2)),
    modifier,
  };
}

module.exports = (supabase) => {
  const router = express.Router();

  // Start research. Completion is handled by the scheduled-event worker.
  router.post('/start', async (req, res) => {
    const body = req.body || {};
    const { agencyId, technologyName, nodeId, engineers: requestedEngineers } = body;

    if (!agencyId || (!technologyName && !nodeId)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const hasEngineerRequest =
      requestedEngineers !== undefined && requestedEngineers !== null && requestedEngineers !== '';
    if (hasEngineerRequest) {
      const parsed = Number(requestedEngineers);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return res.status(400).json({ error: 'engineers must be a non-negative integer' });
      }
    }

    try {
      const agencyQuery = supabase.from('agencies').select('*').eq('id', agencyId).single();
      const techQuery = supabase
        .from('technologies')
        .select('*')
        .eq(nodeId ? 'node_id' : 'name', nodeId || technologyName)
        .single();

      const [{ data: agency, error: agencyError }, { data: tech, error: techError }, season] =
        await Promise.all([agencyQuery, techQuery, loadActiveSeason(supabase)]);

      if (agencyError || !agency) {
        return res.status(404).json({ error: 'Agency not found' });
      }
      if (techError || !tech) {
        return res.status(404).json({ error: 'Technology not found' });
      }

      const embargo = embargoStanding(tech, agency);
      if (embargo.blocked) {
        return res.status(403).json({
          error: `EXPORT EMBARGOED: requires ${tech.alignment_affinity} standing ${embargo.required} (current ${embargo.standing})`,
        });
      }

      const researchCost = resolveResearchCost(tech, agency);
      const validation = AGMEngine.validateResearch(agency, researchCost);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.message });
      }

      const newSciencePoints = Number(agency.science_points || 0) - researchCost.science_points;
      const newFunding = Number(agency.funding_usd || 0) - researchCost.funding_usd;

      const [logResult, nodeResult] = await Promise.all([
        supabase
          .from('logs')
          .select('event_type, description, data')
          .eq('agency_id', agencyId)
          .like('event_type', 'RESEARCH%'),
        supabase.from('agency_tech_nodes').select('*').eq('agency_id', agencyId),
      ]);

      if (logResult.error) throw new Error(`research logs: ${logResult.error.message}`);
      if (nodeResult.error) throw new Error(`agency tech nodes: ${nodeResult.error.message}`);

      const researchLogs = logResult.data || [];
      const nodeRows = nodeResult.data || [];
      const startedTechs = new Set();
      const completedTechs = new Set();

      for (const log of researchLogs) {
        const loggedName = loggedTechnologyName(log);
        if (!loggedName) continue;

        const key = loggedName.toLowerCase();
        startedTechs.add(key);
        if (String(log.event_type || '').includes('COMPLETED')) {
          completedTechs.add(key);
        }
      }

      const existingNode = nodeRows.find((node) => node.node_id === tech.node_id) || null;
      if (
        startedTechs.has(tech.name.toLowerCase())
        || (existingNode && ACTIVE_RESEARCH_STATUSES.has(existingNode.status))
      ) {
        return res.status(400).json({ error: 'Research already started for this technology' });
      }

      const prereqIds = Array.isArray(tech.prerequisite_node_ids)
        ? tech.prerequisite_node_ids
        : [];
      const legacyPrerequisites = Array.isArray(tech.prerequisite) ? tech.prerequisite : [];
      const nodeById = new Map(nodeRows.map((node) => [node.node_id, node]));
      const unlockedNodeIds = new Set(
        nodeRows.filter((node) => node.status === 'UNLOCKED').map((node) => node.node_id),
      );

      let prereqNameById = new Map();
      if (prereqIds.length > 0) {
        const { data: prereqTechs, error: prereqError } = await supabase
          .from('technologies')
          .select('node_id, name')
          .in('node_id', prereqIds);

        if (prereqError) throw new Error(`prerequisites: ${prereqError.message}`);
        prereqNameById = new Map((prereqTechs || []).map((item) => [item.node_id, item.name]));
      }

      const missingPrerequisite = prereqIds.find((requiredNodeId) => {
        if (unlockedNodeIds.has(requiredNodeId)) return false;
        const name = prereqNameById.get(requiredNodeId);
        return !name || !completedTechs.has(String(name).toLowerCase());
      });

      if (missingPrerequisite) {
        const label = prereqNameById.get(missingPrerequisite) || missingPrerequisite;
        return res.status(400).json({ error: `Prerequisite not completed: ${label}` });
      }

      if (prereqIds.length === 0) {
        const missingLegacy = legacyPrerequisites.find(
          (name) => !completedTechs.has(String(name).toLowerCase()),
        );
        if (missingLegacy) {
          return res.status(400).json({ error: `Prerequisite not completed: ${missingLegacy}` });
        }
      }

      const prereqTrlCount = prereqIds.filter(
        (requiredNodeId) => Number(nodeById.get(requiredNodeId)?.current_trl || 0) >= 8,
      ).length;

      const multiplier = Number(season.time_scale_multiplier) || 52.142857;
      const assignedEngineers = assignedEngineersForAgency(
        agency,
        hasEngineerRequest ? requestedEngineers : undefined,
      );
      const durationGameDays = calculateResearchDurationDays({
        baseDays: researchCost.base_days,
        engineers: assignedEngineers,
        prereqTrlCount,
      });
      const durationRealMs = gameDaysToRealMs(durationGameDays, multiplier);
      const durationDays = Math.max(1, Math.ceil(durationRealMs / MS_PER_DAY));
      const roundedGameDays = Number(durationGameDays.toFixed(2));

      const startedAt = new Date();
      const completesAt = new Date(startedAt.getTime() + durationRealMs);
      const seasonId = agency.season_id || season.id;
      const startedAtIso = startedAt.toISOString();
      const completesAtIso = completesAt.toISOString();

      const nodeRow = {
        agency_id: agencyId,
        node_id: tech.node_id,
        status: 'RESEARCHING',
        is_nationalized_variant: false,
        assigned_engineers: assignedEngineers,
        research_started_at: startedAtIso,
        research_completes_at: completesAtIso,
        current_trl: 0,
        trl_xp: 0,
        total_activations: 0,
        failures_recorded: 0,
        license_status: 'NONE',
        local_variant_of: null,
      };

      let scheduledEvent = null;
      let nodeWritten = false;
      let agencyWritten = false;

      try {
        const { error: nodeError } = await supabase
          .from('agency_tech_nodes')
          .upsert([nodeRow], { onConflict: 'agency_id,node_id' });

        if (nodeError) throw new Error(`agency_tech_nodes: ${nodeError.message}`);
        nodeWritten = true;

        const { data: updatedAgency, error: agencyUpdateError } = await supabase
          .from('agencies')
          .update({ science_points: newSciencePoints, funding_usd: newFunding })
          .eq('id', agencyId)
          .eq('science_points', agency.science_points)
          .eq('funding_usd', agency.funding_usd)
          .select('id')
          .maybeSingle();

        if (agencyUpdateError) throw new Error(`agencies update: ${agencyUpdateError.message}`);
        if (!updatedAgency) throw new Error('Agency resources changed; retry the request');
        agencyWritten = true;

        const payload = {
          agency_id: agencyId,
          node_id: tech.node_id,
          technology: tech.name,
          alignment: agency.alignment,
          assigned_engineers: assignedEngineers,
          duration_days: durationDays,
          duration_game_days: roundedGameDays,
          base_days: researchCost.base_days,
          prereq_trl_count: prereqTrlCount,
          cost_science: researchCost.science_points,
          cost_funding_usd: researchCost.funding_usd,
          science_mult: researchCost.modifier.science_mult,
          days_mult: researchCost.modifier.days_mult,
          research_started_at: startedAtIso,
          research_completes_at: completesAtIso,
        };

        const { data: eventRow, error: eventError } = await supabase
          .from('scheduled_events')
          .insert([{
            season_id: seasonId,
            agency_id: agencyId,
            event_type: 'TECH_COMPLETE',
            reference_id: tech.node_id,
            payload,
            execute_at: completesAtIso,
            status: 'PENDING',
          }])
          .select()
          .single();

        if (eventError || !eventRow) {
          throw new Error(`scheduled_events: ${eventError?.message || 'insert failed'}`);
        }
        scheduledEvent = eventRow;

        const { error: logError } = await supabase
          .from('logs')
          .insert([{
            agency_id: agencyId,
            event_type: 'RESEARCH_STARTED',
            description: `Research started: ${tech.name}`,
            data: {
              technology: tech.name,
              node_id: tech.node_id,
              event_id: eventRow.id,
              alignment: agency.alignment,
              cost_science: researchCost.science_points,
              cost_funding_usd: researchCost.funding_usd,
              cost_science_base: Number(tech.research_cost_science ?? 0),
              cost_funding_base: Number(tech.research_cost_funding ?? 0),
              duration_days: durationDays,
              duration_game_days: roundedGameDays,
              base_days: researchCost.base_days,
              assigned_engineers: assignedEngineers,
              research_completes_at: completesAtIso,
            },
          }]);

        if (logError) throw new Error(`logs: ${logError.message}`);
      } catch (error) {
        const rollbackErrors = [];

        if (scheduledEvent) {
          const { error: cancelError } = await supabase
            .from('scheduled_events')
            .update({ status: 'CANCELLED', last_error: error.message })
            .eq('id', scheduledEvent.id)
            .eq('status', 'PENDING');
          if (cancelError) rollbackErrors.push(cancelError.message);
        }

        if (agencyWritten) {
          const { error: restoreAgencyError } = await supabase
            .from('agencies')
            .update({
              science_points: agency.science_points,
              funding_usd: agency.funding_usd,
            })
            .eq('id', agencyId);
          if (restoreAgencyError) rollbackErrors.push(restoreAgencyError.message);
        }

        if (nodeWritten) {
          let restoreNodeError = null;
          if (existingNode) {
            const { error } = await supabase
              .from('agency_tech_nodes')
              .update({
                status: existingNode.status,
                is_nationalized_variant: existingNode.is_nationalized_variant,
                assigned_engineers: existingNode.assigned_engineers,
                research_started_at: existingNode.research_started_at,
                research_completes_at: existingNode.research_completes_at,
                current_trl: existingNode.current_trl,
                trl_xp: existingNode.trl_xp,
                total_activations: existingNode.total_activations,
                failures_recorded: existingNode.failures_recorded,
                license_status: existingNode.license_status,
                local_variant_of: existingNode.local_variant_of,
                nationalized_at: existingNode.nationalized_at,
              })
              .eq('id', existingNode.id);
            restoreNodeError = error;
          } else {
            const { error } = await supabase
              .from('agency_tech_nodes')
              .delete()
              .eq('agency_id', agencyId)
              .eq('node_id', tech.node_id);
            restoreNodeError = error;
          }
          if (restoreNodeError) rollbackErrors.push(restoreNodeError.message);
        }

        if (rollbackErrors.length > 0) {
          console.error('Research start rollback failed:', rollbackErrors.join('; '));
        }

        throw error;
      }

      res.status(201).json({
        message: 'Research started',
        technology: tech.name,
        nodeId: tech.node_id,
        durationDays,
        durationGameDays: roundedGameDays,
        assignedEngineers,
        researchCompletesAt: completesAtIso,
        eventId: scheduledEvent.id,
        cost: {
          science_points: researchCost.science_points,
          funding_usd: researchCost.funding_usd,
        },
        newStats: {
          science_points: newSciencePoints,
          funding_usd: newFunding,
          rp: Number(agency.rp || 0),
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Schedule a static fire test for an unlocked node.
  router.post('/static-fire', async (req, res) => {
    const { agencyId, nodeId } = req.body || {};
    if (!agencyId || !nodeId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      const [{ data: agency, error: agencyError }, { data: tech, error: techError }, season] =
        await Promise.all([
          supabase.from('agencies').select('*').eq('id', agencyId).single(),
          supabase.from('technologies').select('*').eq('node_id', nodeId).single(),
          loadActiveSeason(supabase),
        ]);

      if (agencyError || !agency) {
        return res.status(404).json({ error: 'Agency not found' });
      }
      if (techError || !tech) {
        return res.status(404).json({ error: 'Technology not found' });
      }

      const { data: node, error: nodeError } = await supabase
        .from('agency_tech_nodes')
        .select('*')
        .eq('agency_id', agencyId)
        .eq('node_id', nodeId)
        .maybeSingle();

      if (nodeError) throw new Error(`agency tech node: ${nodeError.message}`);
      if (!node) return res.status(404).json({ error: 'Technology not unlocked for this agency' });
      if (node.status !== 'UNLOCKED') {
        return res.status(400).json({ error: `Static fire requires UNLOCKED node, found ${node.status}` });
      }
      if (Number(node.current_trl) >= Number(tech.max_trl ?? 9)) {
        return res.status(400).json({ error: 'TRL ceiling reached for this technology' });
      }

      const { data: pendingTest, error: pendingError } = await supabase
        .from('scheduled_events')
        .select('id')
        .eq('agency_id', agencyId)
        .eq('event_type', 'STATIC_FIRE')
        .eq('reference_id', nodeId)
        .eq('status', 'PENDING')
        .limit(1)
        .maybeSingle();

      if (pendingError) throw new Error(`pending static fire: ${pendingError.message}`);
      if (pendingTest) {
        return res.status(400).json({ error: 'A static fire is already scheduled for this node' });
      }

      const testCost = Math.max(0, Number(tech.static_test_cost || 0));
      if (Number(agency.funding_usd || 0) < testCost) {
        return res.status(400).json({ error: 'Insufficient funding' });
      }

      const multiplier = Number(season.time_scale_multiplier) || 52.142857;
      const schedule = planStaticFire({
        seed: hashSeed(randomUUID()),
        multiplier,
      });
      const newFunding = Number(agency.funding_usd || 0) - testCost;

      let scheduledEvent = null;
      let agencyWritten = false;

      try {
        const { data: eventRow, error: eventError } = await supabase
          .from('scheduled_events')
          .insert([{
            season_id: agency.season_id || season.id,
            agency_id: agencyId,
            event_type: 'STATIC_FIRE',
            reference_id: nodeId,
            payload: {
              agency_id: agencyId,
              node_id: nodeId,
              technology: tech.name,
              burn_seconds: schedule.burnSeconds,
              rated_seconds: schedule.ratedSeconds,
              duration_game_days: schedule.durationGameDays,
              test_cost_usd: testCost,
              completes_at: schedule.completesAt,
            },
            execute_at: schedule.completesAt,
            status: 'PENDING',
          }])
          .select()
          .single();

        if (eventError || !eventRow) {
          throw new Error(`scheduled_events: ${eventError?.message || 'insert failed'}`);
        }
        scheduledEvent = eventRow;

        const { data: updatedAgency, error: agencyUpdateError } = await supabase
          .from('agencies')
          .update({ funding_usd: newFunding })
          .eq('id', agencyId)
          .eq('funding_usd', agency.funding_usd)
          .select('id')
          .maybeSingle();

        if (agencyUpdateError) throw new Error(`agencies update: ${agencyUpdateError.message}`);
        if (!updatedAgency) throw new Error('Agency resources changed; retry the request');
        agencyWritten = true;

        const { error: logError } = await supabase
          .from('logs')
          .insert([{
            agency_id: agencyId,
            event_type: 'STATIC_FIRE_STARTED',
            description: `Static fire scheduled: ${tech.name}`,
            data: {
              event_id: eventRow.id,
              node_id: nodeId,
              technology: tech.name,
              burn_seconds: schedule.burnSeconds,
              rated_seconds: schedule.ratedSeconds,
              duration_game_days: schedule.durationGameDays,
              test_cost_usd: testCost,
              completes_at: schedule.completesAt,
            },
          }]);

        if (logError) throw new Error(`logs: ${logError.message}`);
      } catch (error) {
        const rollbackErrors = [];

        if (scheduledEvent) {
          const { error: cancelError } = await supabase
            .from('scheduled_events')
            .update({ status: 'CANCELLED', last_error: error.message })
            .eq('id', scheduledEvent.id)
            .eq('status', 'PENDING');
          if (cancelError) rollbackErrors.push(cancelError.message);
        }

        if (agencyWritten) {
          const { error: restoreAgencyError } = await supabase
            .from('agencies')
            .update({ funding_usd: agency.funding_usd })
            .eq('id', agencyId);
          if (restoreAgencyError) rollbackErrors.push(restoreAgencyError.message);
        }

        if (rollbackErrors.length > 0) {
          console.error('Static fire rollback failed:', rollbackErrors.join('; '));
        }

        throw error;
      }

      res.status(202).json({
        message: 'Static fire scheduled',
        nodeId,
        technology: tech.name,
        durationGameDays: schedule.durationGameDays,
        burnSeconds: schedule.burnSeconds,
        completesAt: schedule.completesAt,
        eventId: scheduledEvent.id,
        testCostUsd: testCost,
        newStats: {
          funding_usd: newFunding,
          science_points: Number(agency.science_points || 0),
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get available technologies. Completion is handled by the scheduled-event worker.
  router.get('/available/:agencyId', async (req, res) => {
    try {
      const { agencyId } = req.params;

      const [techResult, logResult, nodeResult] = await Promise.all([
        supabase.from('technologies').select('*').order('era', { ascending: true }),
        supabase
          .from('logs')
          .select('event_type, description, data, created_at')
          .eq('agency_id', agencyId)
          .like('event_type', 'RESEARCH%')
          .order('created_at', { ascending: false }),
        supabase.from('agency_tech_nodes').select('*').eq('agency_id', agencyId),
      ]);

      if (techResult.error) {
        return res.status(400).json({ error: techResult.error.message });
      }

      res.json({
        technologies: techResult.data || [],
        researchLogs: logResult.error ? [] : logResult.data || [],
        nodes: nodeResult.error ? [] : nodeResult.data || [],
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
