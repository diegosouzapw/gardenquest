const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const config = require('../config');
const { insertLog, upsertUser } = require('../database/postgres');
const { normalizeEmail, normalizeText } = require('../shared/normalize');
const { getRequestIp, getRequestUserAgent } = require('../shared/request');
const {
  createAuthSession,
  getAuthSessionById,
  listActiveAuthSessionsForUser,
  revokeAllAuthSessionsForUser,
  revokeAuthSession,
} = require('../database/auth-sessions');
const { requireAuth } = require('../middleware/authenticate');

const AUTH_COOKIE_NAME = 'auth_token';
const OAUTH_STATE_COOKIE_NAME = 'oauth_state';
const COOKIE_MAX_AGE_MS = Math.max(60_000, Number(config.SESSION_COOKIE_MAX_AGE_MS) || (24 * 60 * 60 * 1000));
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const OAUTH_STATE_BASE_URL = 'https://frontend.local';

function normalizeFrontendPath(value, fallbackPath = '/hub.html') {
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

function decodeOAuthState(value, fallbackPath = '/hub.html') {
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
  const userAgent = getRequestUserAgent(req);
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
    sid: normalizeText(decodedToken?.sid, 128),
  };
}

async function syncUserRecord(user) {
  if (!user?.id) {
    return null;
  }

  try {
    return await upsertUser({
      id: user.id,
      email: user.email || null,
      displayName: user.name || null,
      avatarUrl: user.picture || null,
      touchLastSeen: true,
    });
  } catch (error) {
    console.error('User sync error:', error.message);
    return null;
  }
}

function disconnectUserFromWorld(user, { gameEngine = null, worldGateway = null, reason = 'logout' } = {}) {
  if (!user?.id) {
    return;
  }

  if (worldGateway) {
    worldGateway.disconnectPlayer(user.id, reason).catch((error) => {
      console.error('Queued logout disconnect failed:', error.message);
    });
    return;
  }

  if (gameEngine) {
    gameEngine.disconnectPlayer(user.id, reason);
  }
}

function serializeSession(session, currentSessionId = null) {
  if (!session) {
    return null;
  }

  return {
    id: session.id,
    userEmail: session.userEmail || null,
    userName: session.userName || null,
    ip: session.ip || null,
    userAgent: session.userAgent || null,
    createdAt: session.createdAt || null,
    issuedAt: session.issuedAt || null,
    expiresAt: session.expiresAt || null,
    lastSeenAt: session.lastSeenAt || null,
    revokedAt: session.revokedAt || null,
    revokeReason: session.revokeReason || null,
    isCurrent: Boolean(currentSessionId) && session.id === currentSessionId,
  };
}

function createAuthRoutes({ gameEngine = null, worldGateway = null } = {}) {
  const router = express.Router();

  // ─── Dev-only login (APP_ENV=local) ───────────────────────────
  router.get('/dev-mode', (req, res) => {
    if (config.APP_ENV !== 'local') {
      return res.status(404).json({ error: 'Not found' });
    }

    const defaultEmail = config.ADMIN_GOOGLE_EMAILS?.[0] || 'dev@localhost';
    return res.json({
      devLoginEnabled: true,
      defaultName: 'Dev User',
      defaultEmail,
    });
  });

  router.post('/dev-login', express.json(), async (req, res) => {
    if (config.APP_ENV !== 'local') {
      return res.status(404).json({ error: 'Not found' });
    }

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : 'Dev User';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : 'dev@localhost';

    if (!name || !email) {
      return res.status(400).json({ error: 'name and email are required' });
    }

    const userId = crypto.createHash('sha256').update(`dev:${email}`).digest('hex').slice(0, 32);

    try {
      await syncUserRecord({ id: userId, name, email, picture: null });

      const authSessionId = crypto.randomUUID();
      await createAuthSession({
        id: authSessionId,
        userId,
        userEmail: email,
        userName: name,
        ip: getRequestIp(req),
        userAgent: getRequestUserAgent(req, 512) || null,
        expiresAt: new Date(Date.now() + COOKIE_MAX_AGE_MS),
      });

      const jwtToken = jwt.sign(
        { id: userId, name, email, picture: null, sid: authSessionId },
        config.JWT_SECRET,
        { expiresIn: config.JWT_EXPIRES_IN }
      );

      res.cookie(AUTH_COOKIE_NAME, jwtToken, getCookieOptions());
      trackSilentEvent(req, 'dev_login', { id: userId, name });

      return res.json({
        ok: true,
        redirectTo: '/hub.html',
        user: { id: userId, name, email, isAdmin: isAuthorizedAdminEmail(email) },
      });
    } catch (error) {
      console.error('Dev login error:', error.message);
      return res.status(500).json({ error: 'Dev login failed' });
    }
  });
  // ────────────────────────────────────────────────────────────────

  router.get('/google', (req, res) => {
    trackSilentEvent(req, 'login_start');
    const redirectPath = normalizeFrontendPath(req.query?.redirect, '/hub.html');
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
    const decodedState = decodeOAuthState(state, '/hub.html');
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

      const normalizedUser = {
        id: normalizeText(userInfo.id, 128),
        name: normalizeText(userInfo.name, 255),
        email: normalizeEmail(userInfo.email),
        picture: normalizeText(userInfo.picture, 2048),
      };

      if (!normalizedUser.id) {
        throw new Error('OAuth payload missing user ID');
      }

      await syncUserRecord(normalizedUser);

      const authSessionId = crypto.randomUUID();
      await createAuthSession({
        id: authSessionId,
        userId: normalizedUser.id,
        userEmail: normalizedUser.email || null,
        userName: normalizedUser.name || null,
        ip: getRequestIp(req),
        userAgent: getRequestUserAgent(req, 512) || null,
        expiresAt: new Date(Date.now() + COOKIE_MAX_AGE_MS),
      });

      const jwtToken = jwt.sign(
        {
          id: normalizedUser.id,
          name: normalizedUser.name,
          email: normalizedUser.email,
          picture: normalizedUser.picture,
          sid: authSessionId,
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

  router.get('/me', requireAuth, async (req, res) => {
    const user = req.authUser;
    await syncUserRecord(user);
    trackSilentEvent(req, 'page_view', user);
    trackSilentEvent(req, 'connect', user);
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      picture: user.picture,
      isAdmin: isAuthorizedAdminEmail(user.email),
    });
  });

  router.get('/sessions', requireAuth, async (req, res, next) => {
    try {
      const sessions = await listActiveAuthSessionsForUser(req.authUser.id, 50);
      return res.json({
        items: sessions.map((session) => serializeSession(session, req.authSession?.id || null)),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/sessions/:sessionId/revoke', requireAuth, async (req, res, next) => {
    try {
      const targetSessionId = normalizeText(req.params.sessionId, 128);
      if (!targetSessionId) {
        return res.status(400).json({ error: 'Invalid session ID.' });
      }

      const session = await getAuthSessionById(targetSessionId);
      if (!session || session.userId !== req.authUser.id) {
        return res.status(404).json({ error: 'Session not found.' });
      }

      const revoked = await revokeAuthSession(targetSessionId, 'user_revoke');
      const isCurrentSession = targetSessionId === req.authSession?.id;

      if (isCurrentSession) {
        disconnectUserFromWorld(req.authUser, { gameEngine, worldGateway, reason: 'session_revoke' });
        res.clearCookie(AUTH_COOKIE_NAME, getClearCookieOptions());
      }

      return res.json({
        ok: true,
        revoked: Boolean(revoked),
        session: serializeSession(revoked || session, req.authSession?.id || null),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/logout-all', requireAuth, async (req, res, next) => {
    try {
      const revokedCount = await revokeAllAuthSessionsForUser(req.authUser.id, {
        revokeReason: 'logout_all',
      });

      disconnectUserFromWorld(req.authUser, { gameEngine, worldGateway, reason: 'logout_all' });
      res.clearCookie(AUTH_COOKIE_NAME, getClearCookieOptions());

      return res.json({
        ok: true,
        revokedCount,
      });
    } catch (error) {
      return next(error);
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

    if (user?.id) {
      if (user.sid) {
        revokeAuthSession(user.sid, 'logout').catch((error) => {
          console.error('Session revoke on logout failed:', error.message);
        });
      }
      disconnectUserFromWorld(user, { gameEngine, worldGateway, reason: 'logout' });
    }

    res.clearCookie(AUTH_COOKIE_NAME, getClearCookieOptions());
    trackSilentEvent(req, 'disconnect', user);
    res.json({ message: 'Logged out successfully' });
  });

  return router;
}

module.exports = createAuthRoutes;
