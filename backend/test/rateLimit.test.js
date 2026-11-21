const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimitMiddleware } = require('../src/middleware/rateLimit');

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('rate limiter blocks the same user after max writes and resets after the window', async () => {
  let nowMs = 0;
  const limit = createRateLimitMiddleware({
    windowMs: 1000,
    max: 2,
    now: () => nowMs,
  });
  const req = { authUser: { id: 'user-1' }, ip: '127.0.0.1' };

  let nextCalls = 0;
  for (let index = 0; index < 2; index += 1) {
    const res = createResponse();
    await limit(req, res, () => { nextCalls += 1; });
    assert.equal(res.statusCode, 200);
  }
  assert.equal(nextCalls, 2);

  const blocked = createResponse();
  await limit(req, blocked, () => { nextCalls += 1; });
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.error, 'RATE_LIMITED');
  assert.equal(blocked.body.retryAfterMs, 1000);
  assert.equal(blocked.headers['Retry-After'], '1');
  assert.equal(nextCalls, 2);

  const otherUser = createResponse();
  await limit({ authUser: { id: 'user-2' }, ip: '127.0.0.1' }, otherUser, () => { nextCalls += 1; });
  assert.equal(otherUser.statusCode, 200);
  assert.equal(nextCalls, 3);

  nowMs = 1001;
  const reset = createResponse();
  await limit(req, reset, () => { nextCalls += 1; });
  assert.equal(reset.statusCode, 200);
  assert.equal(nextCalls, 4);
});
