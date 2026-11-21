const crypto = require('node:crypto');

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function keyMatches(provided, expected) {
  if (!provided || !expected) return false;
  return crypto.timingSafeEqual(digest(provided), digest(expected));
}

function createGmAuthMiddleware({ accessKey = process.env.GM_ACCESS_KEY } = {}) {
  const configuredKey = String(accessKey || '').trim();

  return function requireGmKey(req, res, next) {
    if (!configuredKey) {
      return res.status(503).json({
        error: 'GM_DISABLED',
        message: 'Set GM_ACCESS_KEY in backend/.env and restart the backend.',
      });
    }

    const provided = req.get('x-gm-key') || '';
    if (!keyMatches(provided, configuredKey)) {
      return res.status(401).json({ error: 'GM_UNAUTHORIZED' });
    }

    return next();
  };
}

module.exports = { createGmAuthMiddleware };
