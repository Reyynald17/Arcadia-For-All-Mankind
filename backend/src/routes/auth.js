const express = require('express');
const router = express.Router();

module.exports = (supabase) => {
  // Register Agency
  router.post('/register', async (req, res) => {
    try {
      const { email, password, agencyName, country, culture, history, targets } = req.body;

      // Validate input
      if (!email || !password || !agencyName) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Create Supabase user
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      });

      if (authError) {
        console.error('Auth error:', authError);
        return res.status(400).json({ error: authError.message });
      }

      // Create agency in database
      const { data: agency, error: agencyError } = await supabase
        .from('agencies')
        .insert([
          {
            user_id: authData.user.id,
            name: agencyName,
            country,
            culture,
            history,
            targets,
            ap: 25,
            budget: 50,
            rp: 0,
            si: 70,
            ipi: 60,
            slr: 0,
            total_launches: 0,
            successful_launches: 0
          }
        ])
        .select();

      if (agencyError) {
        console.error('Agency insert error:', agencyError);
        return res.status(400).json({ error: agencyError.message, details: agencyError });
      }

      res.status(201).json({
        message: 'Agency registered successfully',
        agency: agency[0],
        user: authData.user
      });
    } catch (error) {
      console.error('Register error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Login (return session token)
  router.post('/login', async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        console.error('Login error:', error);
        return res.status(401).json({ error: error.message });
      }

      res.json({
        message: 'Login successful',
        session: data.session,
        user: data.user
      });
    } catch (error) {
      console.error('Login catch error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
