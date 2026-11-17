const express = require('express');
const { createAuthMiddleware } = require('../middleware/auth');
const { normalizeAgencyProfile } = require('../services/agencyProfile');

module.exports = (supabase) => {
  const router = express.Router();
  const authenticate = createAuthMiddleware(supabase);

  // Complete or update the agency profile (alignment, bloc, launch site)
  router.patch('/:agencyId/profile', authenticate, async (req, res) => {
    try {
      const { agencyId } = req.params;

      const { data: agency, error: agencyError } = await supabase
        .from('agencies')
        .select('id, user_id, alignment, alignment_locked_at, profile_complete')
        .eq('id', agencyId)
        .single();

      if (agencyError || !agency) {
        return res.status(404).json({ error: 'AGENCY_NOT_FOUND', message: 'Agency not found.' });
      }

      if (String(agency.user_id) !== String(req.authUser.id)) {
        return res.status(403).json({ error: 'FORBIDDEN_AGENCY', message: 'You do not control this agency.' });
      }

      const { profile, error: profileError } = normalizeAgencyProfile(req.body, { requireComplete: true });
      if (profileError) {
        return res.status(400).json({ error: 'INVALID_PROFILE', message: profileError });
      }

      const alignmentLocked = Boolean(agency.alignment_locked_at || agency.profile_complete);
      if (alignmentLocked && profile.alignment !== agency.alignment) {
        return res.status(409).json({
          error: 'ALIGNMENT_LOCKED',
          message: 'Alignment has already been locked and cannot be changed.'
        });
      }

      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('agencies')
        .update({
          alignment: profile.alignment,
          bloc: profile.bloc,
          launch_site_lat: profile.launch_site_lat,
          launch_site_lon: profile.launch_site_lon,
          launch_site_name: profile.launch_site_name,
          profile_complete: true,
          alignment_locked_at: agency.alignment_locked_at || now,
          updated_at: now
        })
        .eq('id', agencyId)
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: 'PROFILE_UPDATE_FAILED', message: error.message });
      }

      res.json({ message: 'Agency profile saved', agency: data });
    } catch (error) {
      console.error('Profile update error:', error);
      res.status(500).json({ error: 'PROFILE_UPDATE_FAILED', message: error.message });
    }
  });
  // Get agency by user ID
  router.get('/:userId', async (req, res) => {
    try {
      const { userId } = req.params;

      const { data, error } = await supabase
        .from('agencies')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) {
        return res.status(404).json({ error: 'Agency not found' });
      }

      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update agency stats (internal use)
  router.post('/:agencyId/update-stats', async (req, res) => {
    try {
      const { agencyId } = req.params;
      const { science_points, funding_usd, rp, si, ipi, slr } = req.body;

      const { data, error } = await supabase
        .from('agencies')
        .update({
          science_points: science_points !== undefined ? science_points : undefined,
          funding_usd: funding_usd !== undefined ? funding_usd : undefined,
          rp: rp !== undefined ? rp : undefined,
          si: si !== undefined ? si : undefined,
          ipi: ipi !== undefined ? ipi : undefined,
          slr: slr !== undefined ? slr : undefined
        })
        .eq('id', agencyId)
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      res.json({ message: 'Agency updated', agency: data });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all agencies (for ranking)
  router.get('/', async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('agencies')
        .select('id, name, country, rp, si, ipi, slr, total_launches, successful_launches')
        .order('rp', { ascending: false })
        .limit(50);

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};