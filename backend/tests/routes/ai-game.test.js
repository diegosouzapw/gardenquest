const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');

const createAiGameRoutes = require('../../routes/ai-game');

function createApp(routeFactoryOptions = {}) {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/v1/ai-game', createAiGameRoutes(routeFactoryOptions));
  app.use((error, _req, res, _next) => {
    res.status(500).json({ error: error.message });
  });
  return app;
}

test('GET /api/v1/ai-game/public-events returns 503 when repository is unavailable', async () => {
  const app = createApp();

  const response = await request(app).get('/api/v1/ai-game/public-events');

  assert.equal(response.status, 503);
  assert.equal(response.body.error, 'World event feed is not configured.');
});

test('GET /api/v1/ai-game/public-state-live returns spectator state from gateway', async () => {
  const app = createApp({
    worldGateway: {
      async getSpectatorState() {
        return { tick: 123, worldVersion: 1 };
      },
    },
  });

  const response = await request(app).get('/api/v1/ai-game/public-state-live');

  assert.equal(response.status, 200);
  assert.equal(response.body.tick, 123);
  assert.equal(response.body.worldVersion, 1);
});

test('GET /api/v1/ai-game/public-state requires authentication', async () => {
  const app = createApp();

  const response = await request(app).get('/api/v1/ai-game/public-state');

  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'Invalid, expired, or revoked session');
});
