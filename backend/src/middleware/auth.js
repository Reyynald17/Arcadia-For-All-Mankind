/**
 * Authentication middleware
 */

const validateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid token' });
    }

    // Legacy middleware retained for routes that explicitly opt out of JWT
    // verification. Diplomacy routes use createAuthMiddleware instead.
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
};

function createAuthMiddleware(supabase) {
  if (!supabase?.auth?.getUser) {
    throw new Error('Supabase client with auth.getUser is required');
  }

  return async function requireAuth(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          error: 'AUTH_REQUIRED',
          message: 'Missing or invalid bearer token.',
        });
      }

      const token = authHeader.slice('Bearer '.length).trim();
      if (!token) {
        return res.status(401).json({
          error: 'AUTH_REQUIRED',
          message: 'Missing or invalid bearer token.',
        });
      }

      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user?.id) {
        return res.status(401).json({
          error: 'AUTH_REQUIRED',
          message: 'Invalid or expired session.',
        });
      }

      req.authUser = data.user;
      next();
    } catch (error) {
      res.status(401).json({
        error: 'AUTH_REQUIRED',
        message: 'Authentication failed.',
      });
    }
  };
}

function createAgencyOwnershipMiddleware(supabase) {
  return async function requireOwnedAgency(req, res, next) {
    try {
      const agencyId = req.params?.agencyId || req.body?.agencyId;
      if (!agencyId) {
        return res.status(400).json({
          error: 'AGENCY_REQUIRED',
          message: 'agencyId is required.',
        });
      }

      const { data: agency, error } = await supabase
        .from('agencies')
        .select('id, user_id, controller_type')
        .eq('id', agencyId)
        .maybeSingle();

      if (error) {
        console.error(`[auth] agency lookup: ${error.message}`);
        return res.status(500).json({
          error: 'OWNERSHIP_CHECK_FAILED',
          message: 'Could not verify agency ownership.',
        });
      }
      if (!agency) {
        return res.status(404).json({
          error: 'AGENCY_NOT_FOUND',
          message: 'Agency not found.',
        });
      }
      if (
        agency.controller_type !== 'player'
        || String(agency.user_id || '') !== String(req.authUser?.id || '')
      ) {
        return res.status(403).json({
          error: 'FORBIDDEN_AGENCY',
          message: 'You do not control this agency.',
        });
      }

      req.ownedAgency = agency;
      next();
    } catch (error) {
      console.error(`[auth] ownership check: ${error?.message || 'unknown error'}`);
      res.status(500).json({
        error: 'OWNERSHIP_CHECK_FAILED',
        message: 'Could not verify agency ownership.',
      });
    }
  };
}

module.exports = {
  validateToken,
  createAuthMiddleware,
  createAgencyOwnershipMiddleware,
};