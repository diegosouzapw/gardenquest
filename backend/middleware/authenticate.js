const jwt = require('jsonwebtoken');
const config = require('../config');
const authSessionRepository = require('../database/auth-sessions');

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

async function requireAuth(req, res, next) {
  const user = await getAuthenticatedUser(req, {
    requireActiveSession: true,
    touchSession: true,
  });
  if (!user) {
    return res.status(401).json({ error: 'Invalid, expired, or revoked session' });
  }

  req.authUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    picture: user.picture,
    sessionId: user.sessionId,
    sid: user.sessionId,
  };
  req.authSession = user.session || null;
  return next();
}

function readAuthToken(req) {
  const token = req.cookies?.auth_token;
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}

function decodeAuthToken(token) {
  const decoded = jwt.verify(token, config.JWT_SECRET);
  const id = normalizeText(decoded?.id, 128);
  if (!id) {
    return null;
  }
  return {
    id,
    name: normalizeText(decoded?.name, 255),
    email: normalizeEmail(decoded?.email),
    picture: normalizeText(decoded?.picture, 1024),
    sessionId: normalizeText(decoded?.sid, 128),
  };
}

async function getAuthenticatedUser(req, { requireActiveSession = true, touchSession = true } = {}) {
  const token = readAuthToken(req);
  if (!token) {
    return null;
  }

  try {
    const decoded = decodeAuthToken(token);
    if (!decoded) {
      return null;
    }

    if (!decoded.sessionId) {
      return requireActiveSession ? null : decoded;
    }

    const session = await authSessionRepository.getActiveAuthSession(decoded.sessionId);
    if (!session || session.userId !== decoded.id) {
      return null;
    }

    if (touchSession) {
      const sessionTouchIntervalMs = Math.max(
        10_000,
        Number(config.SESSION_TOUCH_INTERVAL_MS) || (5 * 60 * 1000)
      );
      const lastSeenAtMs = session?.lastSeenAt ? new Date(session.lastSeenAt).getTime() : 0;
      if (!lastSeenAtMs || (Date.now() - lastSeenAtMs) >= sessionTouchIntervalMs) {
        authSessionRepository.touchAuthSession(decoded.sessionId).catch((error) => {
          console.error('Failed to touch auth session:', error.message);
        });
      }
    }

    return {
      ...decoded,
      session,
    };
  } catch (error) {
    return null;
  }
}

function getAdminEmails() {
  return Array.isArray(config.ADMIN_GOOGLE_EMAILS)
    ? config.ADMIN_GOOGLE_EMAILS
    : String(config.ADMIN_GOOGLE_EMAILS || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
}

async function requireAdmin(req, res, next) {
  const user = await getAuthenticatedUser(req, {
    requireActiveSession: true,
    touchSession: true,
  });
  if (!user) {
    return res.status(401).json({ error: 'Invalid, expired, or revoked session' });
  }

  const adminEmails = getAdminEmails();
  if (!user.email || !adminEmails.includes(user.email)) {
    return res.status(403).json({ error: 'Forbidden: admin access required' });
  }

  req.authUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    picture: user.picture,
    sessionId: user.sessionId,
    sid: user.sessionId,
  };
  req.authSession = user.session || null;
  return next();
}

module.exports = { requireAuth, requireAdmin, getAuthenticatedUser, decodeAuthToken };
