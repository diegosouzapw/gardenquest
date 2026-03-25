const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');

const AUTH_MODULE_PATH = require.resolve('../../middleware/authenticate');
const PLATFORM_ROUTE_PATH = require.resolve('../../routes/platform');

function createApp(createPlatformRoutes) {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/v1/platform', createPlatformRoutes());
  app.use((error, _req, res, _next) => {
    res.status(500).json({ error: error.message });
  });
  return app;
}

function loadPlatformRoutesWithAuthStub(getAuthenticatedUserStub) {
  const authenticate = require(AUTH_MODULE_PATH);
  const original = authenticate.getAuthenticatedUser;
  authenticate.getAuthenticatedUser = getAuthenticatedUserStub;

  delete require.cache[PLATFORM_ROUTE_PATH];
  const createPlatformRoutes = require('../../routes/platform');

  return {
    createPlatformRoutes,
    restore() {
      authenticate.getAuthenticatedUser = original;
      delete require.cache[PLATFORM_ROUTE_PATH];
    },
  };
}

test('GET /api/v1/platform/bootstrap requires authentication', async () => {
  const { createPlatformRoutes } = loadPlatformRoutesWithAuthStub(async () => null);
  const app = createApp(createPlatformRoutes);

  const response = await request(app).get('/api/v1/platform/bootstrap');

  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'Invalid, expired, or revoked session');
});

test('GET /api/v1/platform/bootstrap returns payload for authenticated user', async () => {
  const { createPlatformRoutes, restore } = loadPlatformRoutesWithAuthStub(async () => ({
    id: 'user-1',
    name: 'Teste',
    email: 'teste@example.com',
    picture: null,
    sessionId: 'sess-1',
  }));

  try {
    const app = createApp(createPlatformRoutes);
    const response = await request(app).get('/api/v1/platform/bootstrap');

    assert.equal(response.status, 200);
    assert.equal(response.body.user.id, 'user-1');
    assert.equal(response.body.platform.hubPath, '/hub.html');
    assert.ok(Array.isArray(response.body.games));
  } finally {
    restore();
  }
});

test('POST /api/v1/platform/events validates event name', async () => {
  const { createPlatformRoutes, restore } = loadPlatformRoutesWithAuthStub(async () => ({
    id: 'user-1',
    name: 'Teste',
    email: 'teste@example.com',
    picture: null,
    sessionId: 'sess-1',
  }));

  try {
    const app = createApp(createPlatformRoutes);
    const response = await request(app)
      .post('/api/v1/platform/events')
      .send({ event: '!' });

    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'Invalid platform event.');
  } finally {
    restore();
  }
});
