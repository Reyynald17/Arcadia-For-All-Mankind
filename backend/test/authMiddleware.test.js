const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase } = require('../test-support/fakeSupabase');
const {
  createAuthMiddleware,
  createAgencyOwnershipMiddleware,
} = require('../src/middleware/auth');

function createResponse() {
  return {
    statusCode: 200,
    body: null,
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

function createDatabase() {
  return {
    agencies: [{
      id: 'agency-1',
      user_id: 'user-1',
      controller_type: 'player',
    }, {
      id: 'agency-npc',
      user_id: null,
      controller_type: 'npc',
    }],
  };
}

test('auth middleware rejects missing and invalid tokens', async () => {
  const authenticate = createAuthMiddleware({
    auth: {
      getUser: async (token) => (
        token === 'valid-token'
          ? { data: { user: { id: 'user-1' } }, error: null }
          : { data: { user: null }, error: { message: 'invalid' } }
      ),
    },
  });

  const missing = createResponse();
  let nextCalled = false;
  await authenticate({ headers: {} }, missing, () => { nextCalled = true; });
  assert.equal(missing.statusCode, 401);
  assert.equal(nextCalled, false);

  const invalid = createResponse();
  await authenticate(
    { headers: { authorization: 'Bearer bad-token' } },
    invalid,
    () => { nextCalled = true; },
  );
  assert.equal(invalid.statusCode, 401);
  assert.equal(nextCalled, false);

  const valid = createResponse();
  const req = { headers: { authorization: 'Bearer valid-token' } };
  await authenticate(req, valid, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.authUser.id, 'user-1');
});

test('agency ownership accepts the owner and rejects other players or NPCs', async () => {
  const { client } = createFakeSupabase(createDatabase());
  const requireOwnedAgency = createAgencyOwnershipMiddleware(client);

  const ownerReq = {
    params: { agencyId: 'agency-1' },
    body: {},
    authUser: { id: 'user-1' },
  };
  let nextCalled = false;
  await requireOwnedAgency(ownerReq, createResponse(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(ownerReq.ownedAgency.id, 'agency-1');

  const otherPlayer = createResponse();
  await requireOwnedAgency(
    { params: { agencyId: 'agency-1' }, body: {}, authUser: { id: 'user-2' } },
    otherPlayer,
    () => {},
  );
  assert.equal(otherPlayer.statusCode, 403);
  assert.equal(otherPlayer.body.error, 'FORBIDDEN_AGENCY');

  const npc = createResponse();
  await requireOwnedAgency(
    { params: { agencyId: 'agency-npc' }, body: {}, authUser: { id: 'user-1' } },
    npc,
    () => {},
  );
  assert.equal(npc.statusCode, 403);

  const missing = createResponse();
  await requireOwnedAgency(
    { params: {}, body: {}, authUser: { id: 'user-1' } },
    missing,
    () => {},
  );
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.body.error, 'AGENCY_REQUIRED');

  const notFound = createResponse();
  await requireOwnedAgency(
    { params: { agencyId: 'missing' }, body: {}, authUser: { id: 'user-1' } },
    notFound,
    () => {},
  );
  assert.equal(notFound.statusCode, 404);

  const bodyAgency = createResponse();
  const bodyReq = { params: {}, body: { agencyId: 'agency-1' }, authUser: { id: 'user-1' } };
  await requireOwnedAgency(bodyReq, bodyAgency, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});
