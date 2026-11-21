const express = require('express');
const {
  CONTRACT_CATALOG,
  GRANT_CATALOG,
  getContract,
  getGrant,
  requirementMet,
  requirementLabel,
  publicContract,
  publicGrant,
} = require('../services/economyEngine');
const { promoteNextMission } = require('../services/missionQueue');

function migrationMissing(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes('does not exist') ||
    message.includes('Could not find the table')
  );
}

function migrationResponse(res) {
  return res.status(503).json({
    error: 'ECONOMY_MIGRATION_REQUIRED',
    message: 'Apply migrations 008_economy.sql and 009_economy_rls.sql first.',
  });
}

module.exports = (supabase) => {
  const router = express.Router();

  router.get('/offers/:agencyId', async (req, res) => {
    const { agencyId } = req.params;
    try {
      const [agencyResult, contractsResult, grantsResult, rewardsResult] = await Promise.all([
        supabase.from('agencies').select('*').eq('id', agencyId).single(),
        supabase.from('agency_contracts').select('*').eq('agency_id', agencyId),
        supabase.from('agency_grants').select('*').eq('agency_id', agencyId),
        supabase
          .from('mission_rewards')
          .select('*')
          .eq('agency_id', agencyId)
          .order('created_at', { ascending: false })
          .limit(8),
      ]);

      if (agencyResult.error || !agencyResult.data) {
        return res.status(404).json({ error: 'Agency not found' });
      }
      for (const result of [contractsResult, grantsResult, rewardsResult]) {
        if (result.error) {
          if (migrationMissing(result.error)) return migrationResponse(res);
          return res.status(500).json({ error: result.error.message });
        }
      }

      const agency = agencyResult.data;
      const contractRows = contractsResult.data || [];
      const grantRows = grantsResult.data || [];
      const contractByKey = new Map(contractRows.map((row) => [row.contract_key, row]));
      const grantByKey = new Map(grantRows.map((row) => [row.grant_key, row]));

      const contracts = CONTRACT_CATALOG.map((definition) => {
        const row = contractByKey.get(definition.key) || null;
        return {
          ...publicContract(definition, agency),
          status: row?.status || 'AVAILABLE',
          contract_id: row?.id || null,
          mission_id: row?.mission_id || null,
          accepted_at: row?.accepted_at || null,
          completed_at: row?.completed_at || null,
          can_accept: !row && requirementMet(definition.requirement, agency),
        };
      });

      const grants = GRANT_CATALOG.map((definition) => {
        const row = grantByKey.get(definition.key) || null;
        return {
          ...publicGrant(definition, agency),
          claimed: Boolean(row),
          claimed_at: row?.claimed_at || null,
          can_claim: !row && requirementMet(definition.requirement, agency),
        };
      });

      res.json({
        agency: {
          id: agency.id,
          name: agency.name,
          funding_usd: agency.funding_usd,
          science_points: agency.science_points,
          rp: agency.rp,
          total_launches: agency.total_launches,
          successful_launches: agency.successful_launches,
        },
        contracts,
        grants,
        recent_rewards: rewardsResult.data || [],
        catalog: {
          contract_count: CONTRACT_CATALOG.length,
          grant_count: GRANT_CATALOG.length,
        },
      });
    } catch (error) {
      if (migrationMissing(error)) return migrationResponse(res);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/contracts/:key/accept', async (req, res) => {
    const { agencyId } = req.body || {};
    const key = req.params.key;
    if (!agencyId) return res.status(400).json({ error: 'Missing agencyId' });

    const definition = getContract(key);
    if (!definition) return res.status(404).json({ error: 'Contract not found' });

    try {
      const { data: agency, error: agencyError } = await supabase
        .from('agencies')
        .select('*')
        .eq('id', agencyId)
        .single();
      if (agencyError || !agency) return res.status(404).json({ error: 'Agency not found' });
      if (!requirementMet(definition.requirement, agency)) {
        return res.status(400).json({
          error: `Contract requires ${requirementLabel(definition.requirement)}`,
        });
      }

      const { data: existing, error: existingError } = await supabase
        .from('agency_contracts')
        .select('id, status')
        .eq('agency_id', agencyId)
        .eq('contract_key', key)
        .maybeSingle();

      if (existingError) {
        if (migrationMissing(existingError)) return migrationResponse(res);
        return res.status(500).json({ error: existingError.message });
      }
      if (existing) {
        return res.status(409).json({ error: `Contract already ${existing.status}` });
      }

      const { data: contract, error: insertError } = await supabase
        .from('agency_contracts')
        .insert([{
          agency_id: agencyId,
          season_id: agency.season_id || null,
          contract_key: key,
          status: 'ACTIVE',
          payout_funding_usd: definition.reward.funding_usd,
          reward_rp: definition.reward.rp,
          reward_science: definition.reward.science_points,
        }])
        .select()
        .single();

      if (insertError) {
        if (migrationMissing(insertError)) return migrationResponse(res);
        if (String(insertError.message || '').includes('duplicate')) {
          return res.status(409).json({ error: 'Contract already accepted' });
        }
        return res.status(500).json({ error: insertError.message });
      }

      const { error: logError } = await supabase
        .from('logs')
        .insert([{
          agency_id: agencyId,
          event_type: 'CONTRACT_ACCEPTED',
          description: `Contract accepted: ${definition.name}`,
          data: {
            contract_id: contract.id,
            contract_key: key,
            mission_type: definition.missionType,
            reward: definition.reward,
          },
        }]);

      if (logError) {
        console.error(`contract accepted log: ${logError.message}`);
      }

      res.status(201).json({
        contract,
        contract_name: definition.name,
        mission_type: definition.missionType,
        reward: definition.reward,
      });
    } catch (error) {
      if (migrationMissing(error)) return migrationResponse(res);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/grants/:key/claim', async (req, res) => {
    const { agencyId } = req.body || {};
    const key = req.params.key;
    if (!agencyId) return res.status(400).json({ error: 'Missing agencyId' });

    const definition = getGrant(key);
    if (!definition) return res.status(404).json({ error: 'Grant not found' });

    try {
      const { data: agency, error: agencyError } = await supabase
        .from('agencies')
        .select('*')
        .eq('id', agencyId)
        .single();
      if (agencyError || !agency) return res.status(404).json({ error: 'Agency not found' });
      if (!requirementMet(definition.requirement, agency)) {
        return res.status(400).json({
          error: `Grant requires ${requirementLabel(definition.requirement)}`,
        });
      }

      const { data: existing, error: existingError } = await supabase
        .from('agency_grants')
        .select('id')
        .eq('agency_id', agencyId)
        .eq('grant_key', key)
        .maybeSingle();

      if (existingError) {
        if (migrationMissing(existingError)) return migrationResponse(res);
        return res.status(500).json({ error: existingError.message });
      }
      if (existing) return res.status(409).json({ error: 'Grant already claimed' });

      const { data: result, error: rpcError } = await supabase.rpc('claim_agency_grant', {
        p_agency_id: agencyId,
        p_grant_key: key,
        p_funding_usd: definition.reward.funding_usd,
        p_science_points: definition.reward.science_points,
      });

      if (rpcError) {
        if (migrationMissing(rpcError)) return migrationResponse(res);
        return res.status(500).json({ error: rpcError.message });
      }
      if (result?.already_claimed) {
        return res.status(409).json({ error: 'Grant already claimed' });
      }

      const { error: logError } = await supabase
        .from('logs')
        .insert([{
          agency_id: agencyId,
          event_type: 'GRANT_CLAIMED',
          description: `Grant awarded: ${definition.name}`,
          data: {
            grant_key: key,
            funding_usd: definition.reward.funding_usd,
            science_points: definition.reward.science_points,
            new_stats: result,
          },
        }]);

      if (logError) {
        console.error(`grant claim log: ${logError.message}`);
      }

      let promotion = null;
      try {
        promotion = await promoteNextMission(supabase, agencyId);
      } catch (promotionError) {
        console.error(`grant queue promotion: ${promotionError.message}`);
      }

      res.status(201).json({
        grant_key: key,
        grant_name: definition.name,
        reward: definition.reward,
        new_stats: {
          funding_usd: result?.funding_usd,
          science_points: result?.science_points,
        },
        promotion,
      });
    } catch (error) {
      if (migrationMissing(error)) return migrationResponse(res);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
