const jwt = require('jsonwebtoken');
const config = require('../config');

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

function requireAuth(req, res, next) {
  const token = req.cookies?.auth_token;
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const id = normalizeText(decoded?.id, 128);
    if (!id) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.authUser = {
      id,
      name: normalizeText(decoded?.name, 255),
      email: normalizeEmail(decoded?.email),
    };
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  // First ensure auth
  requireAuth(req, res, (authError) => {
    if (authError) {
      return next(authError);
    }

    const adminEmails = (config.ADMIN_GOOGLE_EMAILS || '')
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean);

    if (!req.authUser?.email || !adminEmails.includes(req.authUser.email)) {
      return res.status(403).json({ error: 'Forbidden: admin access required' });
    }

    return next();
  });
}

module.exports = { requireAuth, requireAdmin };
