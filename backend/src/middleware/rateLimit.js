function defaultKeyGenerator(req) {
  const userId = req.authUser?.id;
  if (userId) return `user:${userId}`;
  return `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
}

function createRateLimitMiddleware(options = {}) {
  const windowMs = Number(options.windowMs) > 0 ? Number(options.windowMs) : 60000;
  const max = Number(options.max) > 0 ? Math.floor(Number(options.max)) : 30;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const keyGenerator = typeof options.keyGenerator === 'function'
    ? options.keyGenerator
    : defaultKeyGenerator;
  const hits = new Map();

  return function rateLimit(req, res, next) {
    const nowMs = now();
    const key = keyGenerator(req);
    const cutoff = nowMs - windowMs;
    const recent = (hits.get(key) || []).filter((timestamp) => timestamp > cutoff);

    if (recent.length >= max) {
      const retryAfterMs = Math.max(0, recent[0] + windowMs - nowMs);
      hits.set(key, recent);
      if (typeof res.set === 'function') {
        res.set('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      }
      return res.status(429).json({
        error: 'RATE_LIMITED',
        message: 'Too many requests. Try again shortly.',
        retryAfterMs,
      });
    }

    recent.push(nowMs);
    hits.set(key, recent);

    if (hits.size > 1000) {
      for (const [entryKey, timestamps] of hits) {
        if (timestamps.every((timestamp) => timestamp <= cutoff)) {
          hits.delete(entryKey);
        }
      }
    }

    return next();
  };
}

module.exports = { createRateLimitMiddleware };
