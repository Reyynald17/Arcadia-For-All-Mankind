const express = require('express');
const router = express.Router();
const { validateToken } = require('../middleware/auth');

module.exports = (supabase) => {
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
      const { ap, budget, rp, si, ipi, slr } = req.body;

      const { data, error } = await supabase
        .from('agencies')
        .update({
          ap: ap !== undefined ? ap : undefined,
          budget: budget !== undefined ? budget : undefined,
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