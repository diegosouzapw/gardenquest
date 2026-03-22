const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const config = require('../config');
const { insertLog, upsertUser } = require('../database/postgres');

const AUTH_COOKIE_NAME = 'auth_token';
const OAUTH_STATE_COOKIE_NAME = 'oauth_state';
const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const OAUTH_STATE_BASE_URL = 'https://frontend.local';

function getRequestIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const rawIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || req.socket.remoteAddress || '';
  return rawIp.split(',')[0].trim();
}

function normalizeText(value, maxLength) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}

function normalizeEmail(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

function normalizeFrontendPath(value, fallbackPath = '/game.html') {
  if (typeof value !== 'string' || !value.trim()) {
    return fallbackPath;
  }

  try {
    const parsed = new URL(value, OAUTH_STATE_BASE_URL);
    if (parsed.origin !== OAUTH_STATE_BASE_URL) {
      return fallbackPath;
    }

    if (!parsed.pathname.startsWith('/') || parsed.pathname.includes('..')) {
      return fallbackPath;
    }

    return `${parsed.pathname}${parsed.search}`;
  } catch (error) {
    return fallbackPath;
  }
}

function normalizeStateNonce(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(trimmed) ? trimmed : null;
}

function generateOAuthStateNonce() {
  return crypto.randomBytes(32).toString('hex');
}

function stringsMatch(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return false;
  }

  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function encodeOAuthState({ frontendPath, nonce }) {
  const statePayload = JSON.stringify({
    redirectPath: normalizeFrontendPath(frontendPath),
    nonce: normalizeStateNonce(nonce),
  });

  return Buffer.from(statePayload, 'utf8').toString('base64url');
}

function decodeOAuthState(value, fallbackPath = '/game.html') {
  if (typeof value !== 'string' || !value.trim()) {
    return {
      redirectPath: fallbackPath,
      nonce: null,
    };
  }

  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);

    return {
      redirectPath: normalizeFrontendPath(parsed?.redirectPath, fallbackPath),
      nonce: normalizeStateNonce(parsed?.nonce),
    };
  } catch (error) {
    return {
      redirectPath: fallbackPath,
      nonce: null,
    };
  }
}

function isAuthorizedAdminEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  return Boolean(normalizedEmail) && config.ADMIN_GOOGLE_EMAILS.includes(normalizedEmail);
}

function trackSilentEvent(req, event, user = null) {
  const ip = getRequestIp(req);
  const userAgent = req.headers['user-agent'] || '';
  insertLog({
    event,
    ip,
    userAgent,
    userId: user?.id || null,
    userName: user?.name || null,
    category: 'site',
  }).catch((error) => {
    console.error('Silent log error:', error.message);
  });
}

function getOAuth2Client() {
  return new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    config.GOOGLE_REDIRECT_URI
  );
}

function getFrontendUrl(path = '') {
  const baseUrl = (config.FRONTEND_URL || '').replace(/\/+$/, '');
  return `${baseUrl}${path}`;
}

function buildCookieOptions({ maxAge = COOKIE_MAX_AGE_MS, path = '/' } = {}) {
  return {
    httpOnly: true,
    secure: Boolean(config.COOKIE_SECURE),
    sameSite: config.COOKIE_SAME_SITE,
    maxAge,
    path,
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  };
}

function getCookieOptions() {
  return buildCookieOptions();
}

function getClearCookieOptions() {
  const { maxAge, ...cookieOptions } = getCookieOptions();
  return cookieOptions;
}

function getOAuthStateCookieOptions() {
  return buildCookieOptions({
    maxAge: OAUTH_STATE_MAX_AGE_MS,
    path: '/auth',
  });
}

function getClearOAuthStateCookieOptions() {
  const { maxAge, ...cookieOptions } = getOAuthStateCookieOptions();
  return cookieOptions;
}

function getNormalizedUser(decodedToken) {
  return {
    id: normalizeText(decodedToken?.id, 128),
    name: normalizeText(decodedToken?.name, 255),
    email: normalizeEmail(decodedToken?.email),
    picture: normalizeText(decodedToken?.picture, 2048),
  };
}

function syncUserRecord(user) {
  if (!user?.id) {
    return;
  }

  upsertUser({
    id: user.id,
    email: user.email || null,
    displayName: user.name || null,
    avatarUrl: user.picture || null,
    touchLastSeen: true,
  }).catch((error) => {
    console.error('User sync error:', error.message);
  });
}

function createAuthRoutes({ gameEngine = null } = {}) {
  const router = express.Router();

  router.get('/google', (req, res) => {
    trackSilentEvent(req, 'login_start');
    const redirectPath = normalizeFrontendPath(req.query?.redirect, '/game.html');
    const stateNonce = generateOAuthStateNonce();

    const oauth2Client = getOAuth2Client();
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      prompt: 'select_account',
      state: encodeOAuthState({
        frontendPath: redirectPath,
        nonce: stateNonce,
      }),
    });

    res.cookie(OAUTH_STATE_COOKIE_NAME, stateNonce, getOAuthStateCookieOptions());
    res.redirect(authUrl);
  });

  router.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    const decodedState = decodeOAuthState(state, '/game.html');
    const expectedStateNonce = normalizeStateNonce(req.cookies?.[OAUTH_STATE_COOKIE_NAME]);

    res.clearCookie(OAUTH_STATE_COOKIE_NAME, getClearOAuthStateCookieOptions());

    if (!code) {
      return res.redirect(getFrontendUrl('/index.html?error=no_code'));
    }

    if (!stringsMatch(decodedState.nonce, expectedStateNonce)) {
      trackSilentEvent(req, 'login_state_invalid');
      return res.redirect(getFrontendUrl('/index.html?error=invalid_state'));
    }

    try {
      const oauth2Client = getOAuth2Client();
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const { data: userInfo } = await oauth2.userinfo.get();

      syncUserRecord({
        id: normalizeText(userInfo.id, 128),
        name: normalizeText(userInfo.name, 255),
        email: normalizeEmail(userInfo.email),
        picture: normalizeText(userInfo.picture, 2048),
      });

      const jwtToken = jwt.sign(
        {
          id: userInfo.id,
          name: userInfo.name,
          email: normalizeEmail(userInfo.email),
          picture: userInfo.picture,
        },
        config.JWT_SECRET,
        { expiresIn: config.JWT_EXPIRES_IN }
      );

      res.cookie(AUTH_COOKIE_NAME, jwtToken, getCookieOptions());
      res.redirect(getFrontendUrl(decodedState.redirectPath));
    } catch (error) {
      console.error('OAuth callback error:', error.message);
      res.redirect(getFrontendUrl('/index.html?error=auth_failed'));
    }
  });

  router.get('/me', (req, res) => {
    const token = req.cookies?.[AUTH_COOKIE_NAME];
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
      const decoded = jwt.verify(token, config.JWT_SECRET);
      const user = getNormalizedUser(decoded);
      syncUserRecord(user);
      trackSilentEvent(req, 'page_view', user);
      trackSilentEvent(req, 'connect', user);
      res.json({
        id: decoded.id,
        name: decoded.name,
        email: normalizeEmail(decoded.email),
        picture: decoded.picture,
        isAdmin: isAuthorizedAdminEmail(decoded.email),
      });
    } catch (error) {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  });

  router.post('/logout', (req, res) => {
    const token = req.cookies?.[AUTH_COOKIE_NAME];
    let user = null;

    if (token) {
      try {
        const decoded = jwt.verify(token, config.JWT_SECRET);
        user = getNormalizedUser(decoded);
      } catch (error) {
        user = null;
      }
    }

    if (user?.id && gameEngine) {
      gameEngine.disconnectPlayer(user.id, 'logout');
    }

    res.clearCookie(AUTH_COOKIE_NAME, getClearCookieOptions());
    trackSilentEvent(req, 'disconnect', user);
    res.json({ message: 'Logged out successfully' });
  });

  return router;
}

module.exports = createAuthRoutes;
