const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const config = require('../config');
const AUTH_COOKIE_NAME = 'auth_token';

function buildJsonRateLimiter({ windowMs, max, error, scope, skip }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip,
    handler: (req, res, next, options) => {
      const resetTime = req.rateLimit?.resetTime instanceof Date
        ? req.rateLimit.resetTime.getTime() - Date.now()
        : windowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil(resetTime / 1000));
      res.set('Retry-After', String(retryAfterSeconds));
      res.status(options.statusCode).json({
        error,
        scope,
        retryAfterSeconds,
      });
    },
  });
}

function isAuthRoute(pathname = '') {
  return pathname.startsWith('/auth');
}

function isAiGameRoute(pathname = '') {
  return pathname.startsWith('/api/v1/ai-game/')
    || pathname.startsWith('/api/v1/games/garden-quest/');
}

function isPlatformRoute(pathname = '') {
  return pathname.startsWith('/api/v1/platform/');
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch (error) {
    return null;
  }
}

function normalizeEmail(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

function isUnsafeMethod(method = '') {
  return !['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase());
}

function getRequestSourceOrigin(req) {
  const originHeader = normalizeOrigin(req.headers.origin);
  if (originHeader) {
    return originHeader;
  }

  return normalizeOrigin(req.headers.referer);
}

function isAuthorizedAdminDashboardRequest(req) {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  if (!token) {
    return false;
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const email = normalizeEmail(decoded?.email);
    return Boolean(email) && config.ADMIN_GOOGLE_EMAILS.includes(email);
  } catch (error) {
    return false;
  }
}

function setupSecurity(app) {
  const frontendOrigin = normalizeOrigin(config.FRONTEND_URL);
  const configuredOrigins = config.NODE_ENV === 'development'
    ? [
      frontendOrigin,
      'http://localhost:3000',
      'http://localhost:5500',
      'http://127.0.0.1:5500',
      'http://localhost:8080',
    ]
    : [frontendOrigin];
  const allowedOrigins = new Set(
    configuredOrigins
      .map(normalizeOrigin)
      .filter(Boolean)
  );
  const cspConnectSrc = [
    "'self'",
    frontendOrigin,
    ...(config.CSP_ALLOW_LOCAL_CONNECT_SRC ? ['http://localhost:8080', 'http://127.0.0.1:8080'] : []),
  ].filter(Boolean);

  // Helmet - Security headers (CSP, HSTS, X-Frame-Options, etc.)
  app.use(helmet({
    hsts: config.NODE_ENV === 'production', // Disable HSTS in development (avoids 426/HTTPS issues)
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: cspConnectSrc,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // Cookie Parser
  app.use(cookieParser());

  // Manual CORS bypass for local files in development (origin 'null')
  app.use((req, res, next) => {
    if (config.NODE_ENV === 'development' && req.headers.origin === 'null') {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') {
        return res.status(200).send();
      }
    }
    next();
  });

  app.use(cors({
    origin: (origin, callback) => {
      // In development, allow everything to stay unblocked
      if (config.NODE_ENV === 'development') {
        return callback(null, true);
      }

      // Production logic
      const normalizedOrigin = normalizeOrigin(origin);
      if (!origin || (normalizedOrigin && allowedOrigins.has(normalizedOrigin))) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  app.use([
    '/auth/logout',
    '/auth/logout-all',
    '/auth/sessions',
    '/api/v1/system/sync',
    '/api/v1/system/queue',
    '/api/v1/system/sessions',
    '/api/v1/system/agents',
    '/api/v1/platform/events',
    '/api/v1/ai-game/command',
    '/api/v1/games/garden-quest/command',
  ], (req, res, next) => {
    if (!isUnsafeMethod(req.method) || config.NODE_ENV === 'development') {
      return next();
    }

    const sourceOrigin = getRequestSourceOrigin(req);
    if (sourceOrigin && allowedOrigins.has(sourceOrigin)) {
      return next();
    }

    return res.status(403).json({
      error: 'Invalid request origin.',
      scope: 'browser-origin',
    });
  });

  const generalLimiter = buildJsonRateLimiter({
    windowMs: config.GLOBAL_RATE_LIMIT_WINDOW_MS,
    max: config.GLOBAL_RATE_LIMIT_MAX,
    error: 'Too many requests. Please try again later.',
    scope: 'global',
    skip: (req) => req.path === '/health' || isAuthRoute(req.path) || isAiGameRoute(req.path) || isPlatformRoute(req.path),
  });
  app.use(generalLimiter);

  const authLimiter = buildJsonRateLimiter({
    windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
    max: config.AUTH_RATE_LIMIT_MAX,
    error: 'Too many auth attempts. Please try again later.',
    scope: 'auth',
  });
  app.use('/auth', authLimiter);

  const adminDashboardLimiter = buildJsonRateLimiter({
    windowMs: config.ADMIN_RATE_LIMIT_WINDOW_MS,
    max: config.ADMIN_RATE_LIMIT_MAX,
    error: 'Muitas tentativas de acesso ao painel. Aguarde antes de tentar novamente.',
    scope: 'admin-dashboard',
    skip: (req) => req.method !== 'GET' || isAuthorizedAdminDashboardRequest(req),
  });
  app.use('/api/v1/system/dashboard', adminDashboardLimiter);

  const aiPublicStateLimiter = buildJsonRateLimiter({
    windowMs: config.AI_PUBLIC_STATE_RATE_LIMIT_WINDOW_MS,
    max: config.AI_PUBLIC_STATE_RATE_LIMIT_MAX,
    error: 'Muitas sincronizacoes de estado. Aguarde um instante.',
    scope: 'ai-public-state',
    skip: (req) => req.method !== 'GET',
  });
  app.use(
    [
      '/api/v1/ai-game/bootstrap-state',
      '/api/v1/ai-game/public-state',
      '/api/v1/ai-game/public-state-live',
      '/api/v1/games/garden-quest/bootstrap-state',
      '/api/v1/games/garden-quest/public-state',
      '/api/v1/games/garden-quest/public-state-live',
    ],
    aiPublicStateLimiter
  );

  const aiCommandLimiter = buildJsonRateLimiter({
    windowMs: config.AI_COMMAND_RATE_LIMIT_WINDOW_MS,
    max: config.AI_COMMAND_RATE_LIMIT_MAX,
    error: 'Muitos comandos enviados em sequencia. Aguarde um instante.',
    scope: 'ai-command',
    skip: (req) => req.method !== 'POST',
  });
  app.use(['/api/v1/ai-game/command', '/api/v1/games/garden-quest/command'], aiCommandLimiter);

  // Disable X-Powered-By
  app.disable('x-powered-by');
}

module.exports = { setupSecurity };
