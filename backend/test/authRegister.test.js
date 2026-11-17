const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createFakeSupabase } = require('../test-support/fakeSupabase');
const authRoutes = require('../src/routes/auth');

function wrapDataClient(client, admin) {
  return {
    ...client,
    auth: {
      ...client.auth,
      admin,
    },
  };
}

async function startServer(client, authClient) {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes(client, authClient));

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

const registerBody = {
  email: 'director@example.com',
  password: 'secret123',
  agencyName: 'Asgardian Space',
  country: 'Asgard Kingdom',
  alignment: 'INDEPENDENT',
  launchSiteName: 'Alcantara Launch Center',
  launchSiteLat: -2.37,
  launchSiteLon: -44.4,
};

test('register inserts the agency before issuing a session', async () => {
  const { database, client: dataClient } = createFakeSupabase({ agencies: [] });
  let deletedUser = null;
  const client = wrapDataClient(dataClient, {
    createUser: async () => ({ data: { user: { id: 'user-new', email: registerBody.email } }, error: null }),
    deleteUser: async (id) => {
      deletedUser = id;
      return { data: {}, error: null };
    },
  });
  let sessionCalls = 0;
  const authClient = {
    auth: {
      signInWithPassword: async () => {
        sessionCalls += 1;
        return {
          data: { user: { id: 'user-new' }, session: { access_token: 'access-token' } },
          error: null,
        };
      },
    },
  };
  const { server, baseUrl } = await startServer(client, authClient);

  try {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registerBody),
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.agency.user_id, 'user-new');
    assert.equal(body.agency.profile_complete, true);
    assert.equal(body.session.access_token, 'access-token');
    assert.equal(database.agencies.length, 1);
    assert.equal(sessionCalls, 1);
    assert.equal(deletedUser, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('register completes a half-created account after an earlier RLS failure', async () => {
  const { database, client: dataClient } = createFakeSupabase({ agencies: [] });
  const client = wrapDataClient(dataClient, {
    createUser: async () => ({
      data: { user: null },
      error: { code: 'email_exists', message: 'A user with this email address has already been registered' },
    }),
    deleteUser: async () => ({ data: {}, error: null }),
  });
  const authClient = {
    auth: {
      signInWithPassword: async ({ password }) => {
        if (password !== registerBody.password) {
          return { data: {}, error: { message: 'Invalid login credentials' } };
        }
        return {
          data: { user: { id: 'user-orphan' }, session: { access_token: 'recovered-token' } },
          error: null,
        };
      },
    },
  };
  const { server, baseUrl } = await startServer(client, authClient);

  try {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registerBody),
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.agency.user_id, 'user-orphan');
    assert.equal(body.session.access_token, 'recovered-token');
    assert.equal(database.agencies.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('register rejects an existing account when the password is wrong', async () => {
  const { database, client: dataClient } = createFakeSupabase({ agencies: [] });
  const client = wrapDataClient(dataClient, {
    createUser: async () => ({
      data: { user: null },
      error: { code: 'email_exists', message: 'User already registered' },
    }),
    deleteUser: async () => ({ data: {}, error: null }),
  });
  const authClient = {
    auth: {
      signInWithPassword: async () => ({ data: {}, error: { message: 'Invalid login credentials' } }),
    },
  };
  const { server, baseUrl } = await startServer(client, authClient);

  try {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registerBody),
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error, 'EMAIL_ALREADY_REGISTERED');
    assert.equal(database.agencies.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
