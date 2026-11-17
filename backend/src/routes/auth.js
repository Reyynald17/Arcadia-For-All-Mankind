const express = require('express');
const { normalizeAgencyProfile } = require('../services/agencyProfile');

module.exports = (supabase, authClient = supabase) => {
  const router = express.Router();

  // Register Agency
  router.post('/register', async (req, res) => {
    try {
      const { email, password, agencyName, country, culture, history, targets } = req.body;

      // Validate input
      if (!email || !password || !agencyName) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const { profile, error: profileError } = normalizeAgencyProfile(req.body);
      if (profileError) {
        return res.status(400).json({ error: profileError });
      }

      // Create Supabase user
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      });

      let authUser = authData?.user || null;
      let createdNewUser = false;
      let session = null;

      if (authError) {
        const alreadyExists = authError.code === 'email_exists'
          || authError.code === 'user_already_exists'
          || /already.*(registered|exists)/i.test(authError.message || '');

        if (!alreadyExists) {
          console.error('Auth error:', authError);
          return res.status(400).json({ error: authError.message });
        }

        // A previous attempt may have created the auth user but failed before the
        // agency insert. Verify the password, then finish provisioning.
        const { data: recoverySignIn, error: recoveryError } = await authClient.auth.signInWithPassword({
          email,
          password
        });

        if (recoveryError || !recoverySignIn?.user) {
          return res.status(401).json({
            error: 'EMAIL_ALREADY_REGISTERED',
            message: 'Email sudah terdaftar. Masukkan password yang benar atau login.'
          });
        }

        authUser = recoverySignIn.user;
        session = recoverySignIn.session || null;

        const { data: existingAgency, error: existingAgencyError } = await supabase
          .from('agencies')
          .select('id')
          .eq('user_id', authUser.id)
          .maybeSingle();

        if (existingAgencyError) {
          console.error('Agency lookup error:', existingAgencyError);
          return res.status(500).json({ error: 'AGENCY_LOOKUP_FAILED', message: existingAgencyError.message });
        }

        if (existingAgency) {
          return res.status(409).json({
            error: 'AGENCY_ALREADY_EXISTS',
            message: 'Email ini sudah memiliki agensi. Silakan login.'
          });
        }
      } else {
        createdNewUser = true;
      }

      // Create agency in database (service-role client, bypasses RLS)
      const { data: agency, error: agencyError } = await supabase
        .from('agencies')
        .insert([
          {
            user_id: authUser.id,
            name: agencyName,
            country,
            culture,
            history,
            targets,
            alignment: profile.alignment,
            bloc: profile.bloc,
            launch_site_lat: profile.launch_site_lat,
            launch_site_lon: profile.launch_site_lon,
            launch_site_name: profile.launch_site_name,
            profile_complete: profile.profile_complete,
            alignment_locked_at: profile.profile_complete ? new Date().toISOString() : null,
            science_points: 50,
            funding_usd: 15000000,
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

        if (createdNewUser && authUser?.id) {
          const { error: cleanupError } = await supabase.auth.admin.deleteUser(authUser.id);
          if (cleanupError) {
            console.error('Auth rollback error:', cleanupError);
          }
        }

        return res.status(400).json({ error: agencyError.message });
      }

      // Session is required for JWT-protected routes (diplomacy, etc.)
      if (!session) {
        const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({
          email,
          password
        });

        if (signInError) {
          console.error('Post-register sign-in error:', signInError);
        }
        session = signInData?.session || null;
      }

      res.status(201).json({
        message: 'Agency registered successfully',
        agency: agency[0],
        user: authUser,
        session
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

      const { data, error } = await authClient.auth.signInWithPassword({
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

  // Refresh an expired access token
  router.post('/refresh', async (req, res) => {
    try {
      const { refresh_token } = req.body;

      if (!refresh_token) {
        return res.status(400).json({ error: 'refresh_token required' });
      }

      const { data, error } = await authClient.auth.refreshSession({ refresh_token });

      if (error || !data?.session) {
        return res.status(401).json({ error: 'AUTH_REQUIRED' });
      }

      res.json({ session: data.session });
    } catch (error) {
      console.error('Refresh catch error:', error.message);
      res.status(500).json({ error: 'Refresh failed' });
    }
  });

  return router;
};
