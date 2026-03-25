const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');

const createAuthRoutes = require('../../routes/auth');

function createApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/auth', createAuthRoutes());
  app.use((error, _req, res, _next) => {
    res.status(500).json({ error: error.message });
  });
  return app;
}

test('GET /auth/google redirects to OAuth provider and sets state cookie', async () => {
  const app = createApp();

  const response = await request(app)
    .get('/auth/google')
    .query({ redirect: '/hub.html' });

  assert.equal(response.status, 302);
  assert.match(response.headers.location || '', /accounts\.google\.com/);

  const setCookie = response.headers['set-cookie'] || [];
  assert.ok(setCookie.some((entry) => String(entry).startsWith('oauth_state=')));
});

test('GET /auth/callback without code redirects with no_code error', async () => {
  const app = createApp();

  const response = await request(app).get('/auth/callback');

  assert.equal(response.status, 302);
  assert.match(response.headers.location || '', /error=no_code$/);
});

test('GET /auth/me without session returns 401', async () => {
  const app = createApp();

  const response = await request(app).get('/auth/me');

  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'Invalid, expired, or revoked session');
});
