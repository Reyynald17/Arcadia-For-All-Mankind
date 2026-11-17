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

module.exports = {
  validateToken,
  createAuthMiddleware,
};